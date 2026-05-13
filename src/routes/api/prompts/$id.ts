/**
 * /api/prompts/[id]
 *
 * GET — fetch a single prompt with full version history
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { existsSync } from 'node:fs'
import { isAuthenticatedWithCFAccess } from '../../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../../lib/auth/tenants'

const DB_PATH =
  process.env.PROMPTS_DB_PATH ??
  '/home/ubuntu/data/sqlite/shared/prompts.db'

export const Route = createFileRoute('/api/prompts/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo) {
          return json({ error: 'Forbidden' }, { status: 403 })
        }

        if (!existsSync(DB_PATH)) {
          return json({ error: 'Database not found' }, { status: 503 })
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Database = require('better-sqlite3') as typeof import('better-sqlite3')
          const db = new Database(DB_PATH, { readonly: true, fileMustExist: true })

          const promptId = Number(params.id)
          if (!Number.isFinite(promptId)) {
            return json({ error: 'Invalid id' }, { status: 400 })
          }

          const prompt = db.prepare(`
            SELECT p.id, p.name, p.current_version, p.created_at, p.created_by
            FROM prompts p
            WHERE p.id = ?
          `).get(promptId) as { id: number; name: string; current_version: number; created_at: string; created_by: string } | undefined

          if (!prompt) {
            db.close()
            return json({ error: 'Not found' }, { status: 404 })
          }

          // Mally can only see mally/mally-second assignments
          if (tenantInfo.tenant === 'mally') {
            const assignment = db.prepare(
              "SELECT profile FROM prompt_assignments WHERE prompt_id = ? AND (profile = 'mally' OR profile = 'mally-second')"
            ).get(promptId)
            if (!assignment) {
              db.close()
              return json({ error: 'Not found' }, { status: 404 })
            }
          }

          const versions = db.prepare(`
            SELECT version, body, committed_at, committed_by, notes
            FROM prompt_versions
            WHERE prompt_id = ?
            ORDER BY version DESC
          `).all(promptId)

          const assignment = db.prepare(`
            SELECT profile, version, assigned_at, assigned_by
            FROM prompt_assignments
            WHERE prompt_id = ?
          `).get(promptId)

          db.close()
          return json({ prompt, versions, assignment })
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
