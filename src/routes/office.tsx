import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { useEffect, useState } from 'react'
import { useTenantRole } from '@/hooks/use-tenant-role'

export const Route = createFileRoute('/office')({
  ssr: false,
  component: OfficeRoute,
})

type OfficeMode = 'shared' | 'personal'

const OFFICE_URL: Record<string, Record<OfficeMode, string>> = {
  henry_cos: {
    shared:   'https://office.berl.ai/',
    personal: 'https://henry-personal-office.berl.ai/',
  },
  mally: {
    shared:   'https://mally-office.berl.ai/',
    personal: 'https://mally-personal-office.berl.ai/',
  },
}

function resolveOfficeUrl(tenant: string | null, mode: OfficeMode): string {
  const key = tenant && OFFICE_URL[tenant] ? tenant : 'henry_cos'
  return OFFICE_URL[key][mode]
}

/**
 * /office launcher panel.
 *
 * The upstream Claw3D office apps (hermes-office, hermes-office-personal,
 * hermes-office-mally) set `X-Frame-Options: SAMEORIGIN` + a CSP
 * `frame-ancestors 'self' https://atc-dev.berl.ai` — which blocks atc.berl.ai
 * from iframing them. Until those three repos accept atc.berl.ai in their
 * frame-ancestors lists, the cockpit opens the selected office surface in a
 * new tab instead of an iframe.
 *
 * The Shared|Personal toggle still controls which URL is opened, with
 * per-tenant routing (henry_cos / mally) inherited from useTenantRole().
 */
function OfficeRoute() {
  usePageTitle('Office')
  const [mode, setMode] = useState<OfficeMode>('shared')
  const { tenant, loading } = useTenantRole()
  const officeUrl = resolveOfficeUrl(loading ? null : tenant, mode)
  const displayUrl = officeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')

  const open = () => {
    if (loading) return
    window.open(officeUrl, '_blank', 'noopener,noreferrer')
  }

  // Keyboard shortcut: Enter or Space when the launcher has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement?.tagName !== 'BUTTON') {
        // Only fire when no button is focused (Enter on a button is handled natively)
        if (e.target === document.body) {
          e.preventDefault()
          open()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeUrl, loading])

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface">
      {/* Top toggle: Shared | Personal */}
      <div className="flex items-center gap-1 border-b border-border bg-surface px-3 py-2 shrink-0">
        <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">Office</span>
        {(['shared', 'personal'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              mode === m
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-primary-100/40'
            }`}
          >
            {m === 'shared' ? 'Shared (Oracle)' : 'Personal (Mac)'}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-muted-foreground truncate max-w-[40ch]">
          {displayUrl}
        </span>
      </div>

      {/* Launcher card */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex max-w-lg flex-col items-center gap-5 rounded-2xl border border-border bg-primary-50/40 px-8 py-10 text-center shadow-sm dark:bg-primary-900/20">
          <div className="flex size-16 items-center justify-center rounded-2xl border border-accent-500/30 bg-accent-500/10 text-3xl">
            🏢
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-primary-900 dark:text-primary-100">
              Open {mode === 'shared' ? 'Shared' : 'Personal'} Office
            </h2>
            <p className="text-sm text-muted-foreground">
              {loading
                ? 'Resolving tenant…'
                : `${displayUrl} opens in a new tab`}
            </p>
          </div>
          <button
            onClick={open}
            disabled={loading}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Open in new tab →
          </button>
          <details className="mt-2 w-full text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none opacity-70 hover:opacity-100">
              Why not embedded?
            </summary>
            <p className="mt-2 px-2 text-left leading-relaxed">
              The Claw3D office apps set <code>X-Frame-Options: SAMEORIGIN</code> and
              a CSP that doesn&apos;t list <code>atc.berl.ai</code> as a frame
              ancestor, so the browser refuses to iframe them. Until the upstream
              repos accept atc.berl.ai in their headers, we launch in a new tab.
            </p>
          </details>
        </div>
      </div>
    </div>
  )
}
