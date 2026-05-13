/**
 * GET  /api/oauth-router/active  — returns the currently active OAuth account.
 * POST /api/oauth-router/active  — switches active account (Henry-only).
 *
 * Both proxy to oracle:9317/control/active.
 * When OAUTH_ROUTER_URL is absent (G1 not yet deployed) mocked responses are
 * returned so the AccountSwitcher can be developed stand-alone.
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'
import {
  fetchActive,
  setActive,
  isOAuthRouterMocked,
} from '../../../server/oauth-router-client'

export const Route = createFileRoute('/api/oauth-router/active')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const active = await fetchActive()
          return json({ ...active, mock: isOAuthRouterMocked() })
        } catch (err) {
          console.error('[oauth-router/active GET]', err)
          return json({ error: 'oauth-router unavailable' }, { status: 502 })
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Only Henry's tenant may switch accounts
        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo || tenantInfo.tenant !== 'henry_cos') {
          return json(
            { error: 'Forbidden — only Henry can switch accounts' },
            { status: 403 },
          )
        }

        let alias: string
        try {
          const body = (await request.json()) as { alias?: string }
          if (!body?.alias || typeof body.alias !== 'string') {
            return json({ error: 'Missing required field: alias' }, { status: 400 })
          }
          alias = body.alias
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        const cfEmail = request.headers.get('cf-access-authenticated-user-email')

        try {
          const active = await setActive(alias, cfEmail)
          return json({ ...active, mock: isOAuthRouterMocked() })
        } catch (err) {
          const status =
            err instanceof Error && 'status' in err
              ? (err as Error & { status: number }).status
              : 502
          console.error('[oauth-router/active POST]', err)
          return json({ error: 'Failed to switch account' }, { status })
        }
      },
    },
  },
})
