/**
 * /api/relay/messages
 *
 * Returns recent warroom activity from relay.db, filtered by tenant.
 * Used by the RelayWidget sidebar component.
 *
 * relay.db lives at ~/.hermes/relay.db (Oracle-canonical).
 * The schema has: warroom_sessions, warroom_replies, tenant_acl
 * There is NO `messages` table — we return warroom_replies joined to sessions.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'

const RELAY_DB_PATH = join(
  process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes'),
  'relay.db',
)

export const Route = createFileRoute('/api/relay/messages')({
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

        if (!existsSync(RELAY_DB_PATH)) {
          return json({
            schema_status: 'unknown',
            messages: [],
            reason: 'relay.db not found',
          })
        }

        try {
          // Dynamic import — node:sqlite is only available in Node 22+
          // and may not be available in all environments.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const Database = require("better-sqlite3") as typeof import("better-sqlite3")
          const db = new Database(RELAY_DB_PATH, { readonly: true, fileMustExist: true })

          // Get last 10 warroom sessions with their reply counts
          const rows = db
            .prepare(`
              SELECT
                ws.id,
                ws.started_at,
                ws.initiator,
                ws.kind,
                ws.topic,
                ws.ended_at,
                COUNT(wr.id) AS reply_count
              FROM warroom_sessions ws
              LEFT JOIN warroom_replies wr ON wr.session_id = ws.id
              WHERE ws.initiator = ?
              GROUP BY ws.id
              ORDER BY ws.started_at DESC
              LIMIT 10
            `)
            .all(tenantInfo.tenant === 'mally' ? 'mally' : 'henry') as unknown[]

          db.close()

          return json({ schema_status: 'ok', messages: rows })
        } catch (err) {
          return json({
            schema_status: 'error',
            messages: [],
            reason: err instanceof Error ? err.message : 'db_error',
          })
        }
      },
    },
  },
})
