/**
 * oauth-router-client.ts
 *
 * Typed fetch client for the cockpit-side oauth-router proxy.
 * Used by both the API route handlers (server-side) and, via the
 * /api/oauth-router/* endpoints, the AccountSwitcher component.
 *
 * If OAUTH_ROUTER_URL is not set (G1 not yet deployed), the client returns
 * mocked responses so the AccountSwitcher can be developed and tested
 * independently.
 */

export interface OAuthAccount {
  alias: string
  util5h: number   // 0–1 fraction (e.g. 0.73 = 73 %)
  util7d: number   // 0–1 fraction
  daily_usd: number
  status: 'healthy' | 'idle' | 'degraded'
}

export interface ActiveAccount {
  alias: string
}

// ── Mock data (used when OAUTH_ROUTER_URL is absent) ─────────────────────────

const MOCK_ACCOUNTS: OAuthAccount[] = [
  { alias: 'hb',      util5h: 0.73, util7d: 0.42, daily_usd: 12.40, status: 'healthy' },
  { alias: 'hotmail', util5h: 0.31, util7d: 0.18, daily_usd:  4.20, status: 'healthy' },
  { alias: 'h90-2',   util5h: 0.00, util7d: 0.05, daily_usd:  0.00, status: 'idle'    },
]

const MOCK_ACTIVE: ActiveAccount = { alias: 'hb' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBaseUrl(): string | null {
  return process.env.OAUTH_ROUTER_URL ?? null
}

function isMockMode(): boolean {
  return getBaseUrl() === null
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when operating against mocked data (G1 not yet deployed).
 */
export function isOAuthRouterMocked(): boolean {
  return isMockMode()
}

export async function fetchAccounts(): Promise<OAuthAccount[]> {
  if (isMockMode()) return MOCK_ACCOUNTS

  const resp = await fetch(`${getBaseUrl()}/control/accounts`, {
    headers: { 'Content-Type': 'application/json' },
  })
  if (!resp.ok) throw new Error(`oauth-router /control/accounts ${resp.status}`)
  return (await resp.json()) as OAuthAccount[]
}

export async function fetchActive(): Promise<ActiveAccount> {
  if (isMockMode()) return MOCK_ACTIVE

  const resp = await fetch(`${getBaseUrl()}/control/active`)
  if (!resp.ok) throw new Error(`oauth-router /control/active ${resp.status}`)
  return (await resp.json()) as ActiveAccount
}

/**
 * Switch the active account.
 *
 * @param alias      Target account alias.
 * @param cfEmail    The CF Access email of the caller — forwarded so
 *                   oauth-router can enforce that only Henry can switch.
 */
export async function setActive(
  alias: string,
  cfEmail: string | null,
): Promise<ActiveAccount> {
  if (isMockMode()) {
    // Simulate Henry-only enforcement in mock mode
    const henryEmails = [
      'henryberliand@gmail.com',
      'henry@berliand.com',
      'miranda@berliand.com',
      'laurence_malpass@hotmail.com',
    ]
    const isHenry = cfEmail && henryEmails.includes(cfEmail.trim().toLowerCase())
    if (!isHenry) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    return { alias }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfEmail) headers['cf-access-authenticated-user-email'] = cfEmail

  const resp = await fetch(`${getBaseUrl()}/control/active`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ alias }),
  })
  if (!resp.ok) {
    const err = Object.assign(new Error(`oauth-router /control/active POST ${resp.status}`), {
      status: resp.status,
    })
    throw err
  }
  return (await resp.json()) as ActiveAccount
}

/**
 * Returns the SSE URL for account switch events.
 * The cockpit proxy endpoint handles the actual fetch; this just returns
 * the proxied URL so the component can open an EventSource.
 */
export function getEventsUrl(): string {
  return '/api/oauth-router/events'
}
