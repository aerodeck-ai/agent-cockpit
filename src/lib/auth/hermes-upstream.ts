/**
 * Tenant-aware Hermes upstream resolver.
 *
 * Every server-side route that proxies to Hermes should call
 * `getHermesUpstream(tenant)` to obtain the correct {baseUrl, token}.
 * Cross-tenant calls are impossible by design — this function throws if
 * a tenant has no configured upstream.
 */

import type { Tenant } from './tenants'

export interface HermesUpstream {
  baseUrl: string
  token: string
}

/**
 * Return the Hermes upstream config for a given tenant.
 * Throws a TypeError if the tenant is not configured — callers should catch
 * this and return 403 / 503.
 */
export function getHermesUpstream(tenant: Tenant): HermesUpstream {
  switch (tenant) {
    case 'henry_cos': {
      const baseUrl = process.env.HERMES_API_URL || 'http://127.0.0.1:8642'
      const token   = process.env.HERMES_API_TOKEN || ''
      return { baseUrl, token }
    }
    case 'mally': {
      const baseUrl = process.env.HERMES_BASE_URL_MALLY
      const token   = process.env.HERMES_API_TOKEN_MALLY
      if (!baseUrl || !token) {
        throw new TypeError(
          `[hermes-upstream] Mally upstream not configured. ` +
          `Set HERMES_BASE_URL_MALLY and HERMES_API_TOKEN_MALLY in .env.`,
        )
      }
      return { baseUrl, token }
    }
    default: {
      // Exhaustive check — TypeScript should catch unknown tenants at compile time
      const _exhaustive: never = tenant
      throw new TypeError(`[hermes-upstream] Unknown tenant: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Henry-personal Hermes upstream (optional — used by ProfileSwitcher probe).
 * Returns null if not configured.
 */
export function getHenryPersonalUpstream(): HermesUpstream | null {
  const baseUrl = process.env.HERMES_BASE_URL_HENRY_PERSONAL_TAILSCALE
    || process.env.HERMES_BASE_URL_HENRY_PERSONAL
  const token   = process.env.HERMES_API_TOKEN || ''
  if (!baseUrl) return null
  return { baseUrl, token }
}
