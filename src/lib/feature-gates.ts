// FIX: removed import of getCapabilities from server/gateway-capabilities — that module
// transitively imports node:sqlite (local-db.ts) which cannot be bundled for the browser.
// isFeatureAvailable was the only consumer and had no callers, so it is removed below.

export type EnhancedFeature =
  | 'sessions'
  | 'skills'
  | 'memory'
  | 'config'
  | 'jobs'
  | 'mcp'
  | 'mcpFallback'
  | 'kanban'

const FEATURE_LABELS: Record<EnhancedFeature, string> = {
  sessions: 'Sessions',
  skills: 'Skills',
  memory: 'Memory',
  config: 'Configuration',
  jobs: 'Jobs',
  mcp: 'MCP Servers',
  mcpFallback: 'MCP Servers (config fallback)',
  kanban: 'Kanban (Hermes plugin)',
}

function normalizeFeature(
  feature: EnhancedFeature | string,
): EnhancedFeature | null {
  const normalized = feature.trim().toLowerCase()
  if (
    normalized === 'sessions' ||
    normalized === 'skills' ||
    normalized === 'memory' ||
    normalized === 'config' ||
    normalized === 'jobs' ||
    normalized === 'mcp' ||
    normalized === 'mcpfallback' ||
    normalized === 'kanban'
  ) {
    return normalized === 'mcpfallback' ? 'mcpFallback' : normalized
  }

  return null
}

export function getFeatureLabel(feature: EnhancedFeature | string): string {
  const normalized = normalizeFeature(feature)
  if (!normalized) return feature
  return FEATURE_LABELS[normalized]
}

export function getUnavailableReason(
  feature: EnhancedFeature | string,
): string {
  return `${getFeatureLabel(feature)} requires a Hermes gateway that exposes the extended APIs. Check that Hermes Agent is installed and running with \`hermes gateway run\`.`
}

export function createCapabilityUnavailablePayload(
  feature: EnhancedFeature,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ok: false,
    code: 'capability_unavailable',
    capability: feature,
    source: 'portable',
    message: getUnavailableReason(feature),
    ...extra,
  }
}

// ---------------------------------------------------------------------------
// Per-tenant feature gating (feat/multi-user-cos)
// ---------------------------------------------------------------------------

import type { Tenant } from './auth/tenants'

/**
 * Features that Mally is allowed to use.
 * Everything else is henry-only.
 */
const MALLY_ALLOWED_FEATURES = new Set<EnhancedFeature>([
  'sessions',
  'skills',
  'memory',
  'mcp',
  'mcpFallback',
])

/**
 * Whether a given tenant can access the requested feature.
 *
 * henry_cos → all features allowed
 * mally     → MALLY_ALLOWED_FEATURES only
 */
export function isTenantAllowed(tenant: Tenant, feature: EnhancedFeature): boolean {
  if (tenant === 'henry_cos') return true
  return MALLY_ALLOWED_FEATURES.has(feature)
}

/**
 * Whether a given tenant has write access to the scope_deny editor.
 * Henry → read+write. Mally → read-only.
 */
export function canEditScopeDeny(tenant: Tenant): boolean {
  return tenant === 'henry_cos'
}

/**
 * Server-side enforcement helper.
 * Call in API route handlers before processing Mally requests.
 * Returns a 403 Response if the tenant is not allowed; null if OK.
 */
export function enforceTenantFeatureGate(
  tenant: Tenant,
  feature: EnhancedFeature,
): Response | null {
  if (isTenantAllowed(tenant, feature)) return null
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'Forbidden',
      code: 'tenant_feature_gate',
      tenant,
      feature,
      message: `Tenant "${tenant}" does not have access to feature "${feature}".`,
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  )
}
