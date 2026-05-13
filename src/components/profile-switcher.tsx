/**
 * ProfileSwitcher — shown in the workspace-shell header.
 *
 * Henry sees:  [CoS ●] [Personal ○]  (Personal disabled when Tailscale unreachable)
 * Mally sees:  [Mally CoS] (no switch)
 *
 * Profile state lives in workspace-store so it survives navigation.
 */

import { useEffect, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useWorkspaceStore, type ActiveProfile } from '@/stores/workspace-store'

interface ProfileProbeResult {
  reachable: boolean
  last_checked: string
}

export function ProfileSwitcher() {
  const activeProfile  = useWorkspaceStore((s) => s.activeProfile)
  const setActiveProfile = useWorkspaceStore((s) => s.setActiveProfile)

  const [tenant, setTenant]       = useState<'henry_cos' | 'mally' | null>(null)
  const [personalOk, setPersonalOk] = useState(false)

  // Resolve tenant from /api/auth-check (which now returns tenant info)
  useEffect(() => {
    fetch('/api/auth-check')
      .then((r) => r.json())
      .then((data: { tenant?: string }) => {
        if (data.tenant === 'mally') {
          setTenant('mally')
          setActiveProfile('mally')
        } else {
          setTenant('henry_cos')
        }
      })
      .catch(() => setTenant('henry_cos'))
  }, [setActiveProfile])

  // Probe personal endpoint every 60s (henry only)
  const probePersonal = useCallback(async () => {
    if (tenant !== 'henry_cos') return
    try {
      const r = await fetch('/api/hermes/personal-probe')
      const data = (await r.json()) as ProfileProbeResult
      setPersonalOk(data.reachable)
    } catch {
      setPersonalOk(false)
    }
  }, [tenant])

  useEffect(() => {
    if (tenant !== 'henry_cos') return
    probePersonal()
    const id = setInterval(probePersonal, 60_000)
    return () => clearInterval(id)
  }, [tenant, probePersonal])

  // Don't render until tenant resolved
  if (!tenant) return null

  // Mally — no switch, just a label
  if (tenant === 'mally') {
    return (
      <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted">
        Mally CoS
      </span>
    )
  }

  // Henry — CoS + Personal toggle
  const profiles: { key: ActiveProfile; label: string; disabled?: boolean }[] = [
    { key: 'cos',      label: 'CoS' },
    { key: 'personal', label: 'Personal', disabled: !personalOk },
  ]

  return (
    <div
      role="group"
      aria-label="Active Hermes profile"
      className="flex gap-1 items-center"
    >
      {profiles.map(({ key, label, disabled }) => (
        <button
          key={key}
          disabled={disabled}
          onClick={() => !disabled && setActiveProfile(key)}
          className={cn(
            'text-xs px-2 py-1 rounded transition-colors',
            activeProfile === key
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
            disabled && 'opacity-40 cursor-not-allowed',
          )}
          title={disabled ? 'Personal Hermes not reachable via Tailscale' : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
