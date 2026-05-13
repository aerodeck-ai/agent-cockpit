/**
 * /api/prompts
 *
 * GET  — list all prompts with current version + assignment info
 * POST — create a new prompt
 * PUT  — save a new version of an existing prompt
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { existsSync } from 'node:fs'
import { isAuthenticatedWithCFAccess } from '../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../lib/auth/tenants'

const DB_PATH =
  process.env.PROMPTS_DB_PATH ??
  '/home/ubuntu/data/sqlite/shared/prompts.db'

function getDb(readonly = false) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  return new Database(DB_PATH, readonly ? { readonly: true, fileMustExist: true } : {})
}

export const Route = createFileRoute('/api/prompts')({
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

        if (!existsSync(DB_PATH)) {
          return json({ prompts: [], assignments: [] })
        }

        try {
          const db = getDb(true)
          const isMally = tenantInfo.tenant === 'mally'

          // If mally, only show prompts assigned to mally profile
          const prompts = isMally
            ? db.prepare(`
                SELECT p.id, p.name, p.current_version, p.created_at, p.created_by,
                       pv.body, pa.profile, pa.version as assigned_version
                FROM prompts p
                JOIN prompt_versions pv ON pv.prompt_id = p.id AND pv.version = p.current_version
                LEFT JOIN prompt_assignments pa ON pa.prompt_id = p.id
                WHERE pa.profile = 'mally' OR pa.profile = 'mally-second'
                ORDER BY p.name
              `).all()
            : db.prepare(`
                SELECT p.id, p.name, p.current_version, p.created_at, p.created_by,
                       pv.body, pa.profile, pa.version as assigned_version
                FROM prompts p
                JOIN prompt_versions pv ON pv.prompt_id = p.id AND pv.version = p.current_version
                LEFT JOIN prompt_assignments pa ON pa.prompt_id = p.id
                ORDER BY p.name
              `).all()

          const assignments = db.prepare(`
            SELECT profile, prompt_id, version, assigned_at, assigned_by
            FROM prompt_assignments
            ORDER BY profile
          `).all()

          db.close()
          return json({ prompts, assignments, tenant: tenantInfo.tenant, readonly: isMally })
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },

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

        try {
          const body = await request.json() as { name: string; body: string; notes?: string }
          if (!body.name?.trim() || !body.body?.trim()) {
            return json({ error: 'name and body are required' }, { status: 400 })
          }

          const db = getDb()
          const stmt = db.prepare(
            'INSERT INTO prompts (name, current_version, created_by) VALUES (?, 1, ?)'
          )
          const result = stmt.run(body.name.trim(), tenantInfo.displayName)
          const promptId = result.lastInsertRowid

          db.prepare(
            'INSERT INTO prompt_versions (prompt_id, version, body, committed_by, notes) VALUES (?, 1, ?, ?, ?)'
          ).run(promptId, body.body, tenantInfo.displayName, body.notes ?? null)

          db.close()
          return json({ ok: true, id: promptId })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('UNIQUE constraint')) {
            return json({ error: 'A prompt with that name already exists' }, { status: 409 })
          }
          return json({ error: msg }, { status: 500 })
        }
      },

      PUT: async ({ request }) => {
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

        try {
          const body = await request.json() as { id: number; body: string; notes?: string }
          if (!body.id || !body.body?.trim()) {
            return json({ error: 'id and body are required' }, { status: 400 })
          }

          const db = getDb()
          const prompt = db.prepare('SELECT id, current_version FROM prompts WHERE id = ?').get(body.id) as { id: number; current_version: number } | undefined
          if (!prompt) {
            db.close()
            return json({ error: 'Prompt not found' }, { status: 404 })
          }

          const newVersion = prompt.current_version + 1
          db.prepare(
            'INSERT INTO prompt_versions (prompt_id, version, body, committed_by, notes) VALUES (?, ?, ?, ?, ?)'
          ).run(prompt.id, newVersion, body.body, tenantInfo.displayName, body.notes ?? null)

          db.prepare('UPDATE prompts SET current_version = ? WHERE id = ?').run(newVersion, prompt.id)

          db.close()
          return json({ ok: true, version: newVersion })
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
