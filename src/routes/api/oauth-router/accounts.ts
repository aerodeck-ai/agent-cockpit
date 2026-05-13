/**
 * GET /api/oauth-router/accounts
 *
 * Proxies GET oracle:9317/control/accounts.
 * Returns mocked data when OAUTH_ROUTER_URL is not set (G1 not yet deployed).
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'
import { fetchAccounts, isOAuthRouterMocked } from '../../../server/oauth-router-client'

export const Route = createFileRoute('/api/oauth-router/accounts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const accounts = await fetchAccounts()
          return json({
            accounts,
            mock: isOAuthRouterMocked(),
          })
        } catch (err) {
          console.error('[oauth-router/accounts]', err)
          return json(
            { error: 'oauth-router unavailable' },
            { status: 502 },
          )
        }
      },
    },
  },
})
