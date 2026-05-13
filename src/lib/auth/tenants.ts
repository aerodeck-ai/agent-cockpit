/**
 * CF Access identity → tenant mapping.
 *
 * CF Access injects `cf-access-authenticated-user-email` on every request
 * when the app is behind an Access policy.  We map that email to one of our
 * known tenants so the cockpit can pick the right Hermes upstream and feature
 * set without a password gate.
 *
 * henry_cos  → Henry's chief-of-staff Hermes instance  (:8642)
 * mally      → Mally's Hermes instance                 (:8644)
 *
 * New authorised emails can be added here; they must also appear in the
 * "ATC" CF Access policy (app id d1586a14-33bd-4cd7-8c03-c956d4d7bd4d).
 */

export type Tenant = 'henry_cos' | 'mally'

export interface TenantInfo {
  tenant: Tenant
  displayName: string
}

const EMAIL_TO_TENANT: Record<string, TenantInfo> = {
  'henryberliand@gmail.com': { tenant: 'henry_cos', displayName: 'Henry' },
  'henry@berliand.com':      { tenant: 'henry_cos', displayName: 'Henry' },
  'miranda@berliand.com':    { tenant: 'henry_cos', displayName: 'Henry' },
  'laurence_malpass@hotmail.com': { tenant: 'henry_cos', displayName: 'Henry' },
  'stillmusicofficial@gmail.com': { tenant: 'mally', displayName: 'Mally' },
}

/**
 * Resolve the CF Access email header to a tenant.
 * Returns null if the email is not in the allowlist (should never happen if
 * CF Access policy is correctly configured, but we fail safe).
 */
export function resolveTenantFromEmail(email: string | null | undefined): TenantInfo | null {
  if (!email) return null
  const normalised = email.trim().toLowerCase()
  return EMAIL_TO_TENANT[normalised] ?? null
}

/**
 * Extract the CF Access identity header from a Request and resolve to tenant.
 */
export function resolveTenantFromRequest(request: Request): TenantInfo | null {
  const email = request.headers.get('cf-access-authenticated-user-email')
  return resolveTenantFromEmail(email)
}
