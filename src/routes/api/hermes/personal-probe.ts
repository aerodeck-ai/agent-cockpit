/**
 * /api/hermes/personal-probe
 *
 * Probes Henry's personal Hermes instance over Tailscale to determine if it
 * is reachable.  ProfileSwitcher polls this every 60 s to enable/disable the
 * Personal toggle.
 *
 * Only accessible to henry_cos tenants (CF Access header enforced).
 */

import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'
import { getHenryPersonalUpstream } from '../../../lib/auth/hermes-upstream'
import { isAuthenticatedWithCFAccess } from '../../../server/auth-middleware'

export const Route = createFileRoute('/api/hermes/personal-probe')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Auth gate
        if (!isAuthenticatedWithCFAccess(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const tenantInfo = resolveTenantFromRequest(request)
        if (!tenantInfo || tenantInfo.tenant !== 'henry_cos') {
          return json({ error: 'Forbidden' }, { status: 403 })
        }

        const upstream = getHenryPersonalUpstream()
        if (!upstream) {
          return json({
            reachable: false,
            last_checked: new Date().toISOString(),
            reason: 'HERMES_BASE_URL_HENRY_PERSONAL_TAILSCALE not configured',
          })
        }

        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), 3000)

          const resp = await fetch(`${upstream.baseUrl}/v1/models`, {
            headers: upstream.token
              ? { Authorization: `Bearer ${upstream.token}` }
              : {},
            signal: controller.signal,
          })
          clearTimeout(timeoutId)

          return json({
            reachable: resp.ok,
            last_checked: new Date().toISOString(),
          })
        } catch (err) {
          return json({
            reachable: false,
            last_checked: new Date().toISOString(),
            reason: err instanceof Error ? err.message : 'probe_failed',
          })
        }
      },
    },
  },
})
