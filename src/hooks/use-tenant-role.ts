/**
 * useTenantRole — reads the current user's tenant from /api/auth-check
 * and exposes convenience booleans.
 */
import { useState, useEffect } from 'react'

type TenantRole = {
  tenant: string | null
  displayName: string | null
  isHenry: boolean
  isMally: boolean
  loading: boolean
}

let _cached: { tenant: string | null; displayName: string | null } | null = null

export function useTenantRole(): TenantRole {
  const [state, setState] = useState<{ tenant: string | null; displayName: string | null; loading: boolean }>(
    _cached ? { ..._cached, loading: false } : { tenant: null, displayName: null, loading: true },
  )

  useEffect(() => {
    if (_cached) return
    void fetch('/api/auth-check')
      .then((r) => r.json())
      .then((data: { tenant?: string | null; tenantDisplayName?: string | null }) => {
        _cached = {
          tenant: data.tenant ?? null,
          displayName: data.tenantDisplayName ?? null,
        }
        setState({ ..._cached, loading: false })
      })
      .catch(() => setState({ tenant: null, displayName: null, loading: false }))
  }, [])

  return {
    tenant: state.tenant,
    displayName: state.displayName,
    isHenry: state.tenant === 'henry_cos',
    isMally: state.tenant === 'mally',
    loading: state.loading,
  }
}
