/**
 * Tenant-aware request context for Hermes proxy calls.
 *
 * Usage in API route handlers:
 *
 *   import { getTenantUpstreamForRequest } from '../../server/tenant-context'
 *
 *   const { baseUrl, token } = getTenantUpstreamForRequest(request)
 *   const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
 *     headers: token ? { Authorization: `Bearer ${token}` } : {}
 *   })
 *
 * Falls back to the default HERMES_API_URL / HERMES_API_TOKEN when:
 *   - TRUST_CF_ACCESS is off (local dev / loopback)
 *   - No CF Access header present
 *   - Email not in tenant map
 */

import { resolveTenantFromRequest } from '../lib/auth/tenants'
import { getHermesUpstream } from '../lib/auth/hermes-upstream'
import { isCFAccessTrusted } from './auth-middleware'
import type { HermesUpstream } from '../lib/auth/hermes-upstream'

/** Default upstream — same as the original single-tenant setup */
function defaultUpstream(): HermesUpstream {
  return {
    baseUrl: process.env.HERMES_API_URL || 'http://127.0.0.1:8642',
    token:   process.env.HERMES_API_TOKEN || process.env.CLAUDE_API_TOKEN || '',
  }
}

/**
 * Resolve the Hermes upstream for the incoming request.
 *
 * When CF Access is trusted and the email resolves to a tenant, return that
 * tenant's upstream.  Otherwise return the default (original behaviour).
 */
export function getTenantUpstreamForRequest(request: Request): HermesUpstream {
  if (isCFAccessTrusted()) {
    const tenantInfo = resolveTenantFromRequest(request)
    if (tenantInfo) {
      try {
        return getHermesUpstream(tenantInfo.tenant)
      } catch {
        // Log and fall through to default
        console.warn(
          `[tenant-context] upstream not configured for tenant "${tenantInfo.tenant}" — falling back to default`,
        )
      }
    }
  }
  return defaultUpstream()
}

/**
 * Build the Authorization header object for the resolved upstream.
 */
export function getTenantAuthHeaders(request: Request): Record<string, string> {
  const { token } = getTenantUpstreamForRequest(request)
  return token ? { Authorization: `Bearer ${token}` } : {}
}
