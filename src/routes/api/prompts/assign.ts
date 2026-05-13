/**
 * /api/prompts/assign
 *
 * POST — assign a prompt version to a profile
 *
 * Body: { profile: string, prompt_id: number, version: number }
 *
 * NOTE: This writes the assignment row in prompts.db only.
 * Hot-reloading the running Hermes profile config is out of scope for this PR.
 * TODO: follow-up — call Hermes config reload endpoint after assignment so the
 *       running profile picks up the new SOUL.md content without a restart.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { existsSync } from 'node:fs'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'

const DB_PATH =
  process.env.PROMPTS_DB_PATH ??
  '/home/ubuntu/data/sqlite/shared/prompts.db'

export const Route = createFileRoute('/api/prompts/assign')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo) {
          return json({ error: 'Forbidden' }, { status: 403 })
        }
        if (tenantInfo.tenant === 'mally') {
          return json({ error: 'Read-only access' }, { status: 403 })
        }

        if (!existsSync(DB_PATH)) {
          return json({ error: 'Database not found' }, { status: 503 })
        }

        try {
          const body = await request.json() as { profile: string; prompt_id: number; version: number }
          if (!body.profile?.trim() || !body.prompt_id || !body.version) {
            return json({ error: 'profile, prompt_id, and version are required' }, { status: 400 })
          }

          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Database = require('better-sqlite3') as typeof import('better-sqlite3')
          const db = new Database(DB_PATH)

          // Verify prompt + version exist
          const version = db.prepare(
            'SELECT version FROM prompt_versions WHERE prompt_id = ? AND version = ?'
          ).get(body.prompt_id, body.version)
          if (!version) {
            db.close()
            return json({ error: 'Prompt or version not found' }, { status: 404 })
          }

          db.prepare(`
            INSERT OR REPLACE INTO prompt_assignments (profile, prompt_id, version, assigned_at, assigned_by)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
          `).run(body.profile.trim(), body.prompt_id, body.version, tenantInfo.displayName)

          db.close()
          return json({ ok: true })
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
