import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { useState } from 'react'
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

function OfficeRoute() {
  usePageTitle('Office')
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<OfficeMode>('shared')
  const { tenant, loading } = useTenantRole()

  const iframeSrc = resolveOfficeUrl(loading ? null : tenant, mode)

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface">
      {/* Top toggle: Shared | Personal */}
      <div className="flex items-center gap-1 border-b border-border bg-surface px-3 py-2 shrink-0">
        <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">Office</span>
        {(['shared', 'personal'] as const).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setLoaded(false) }}
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
          {iframeSrc.replace(/^https?:\/\//, '')}
        </span>
      </div>

      <div className="relative flex-1">
        {(!loaded || loading) && (
          <div className="absolute inset-0 z-10 flex flex-col gap-3 p-4 animate-pulse">
            <div className="h-10 w-full rounded-md bg-primary-100/60 dark:bg-primary-800/40" />
            <div className="h-6 w-2/3 rounded bg-primary-100/60 dark:bg-primary-800/40" />
            <div className="flex-1 rounded-lg bg-primary-100/40 dark:bg-primary-800/30" />
          </div>
        )}
        {!loading && (
          <iframe
            key={iframeSrc}
            src={iframeSrc}
            title="Claw3D Office"
            allow="microphone; clipboard-read; clipboard-write"
            className="h-full w-full border-0"
            onLoad={() => setLoaded(true)}
            style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
          />
        )}
      </div>
    </div>
  )
}
