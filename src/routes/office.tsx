import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { useState } from 'react'
import { useTenantRole } from '@/hooks/use-tenant-role'

export const Route = createFileRoute('/office')({
  ssr: false,
  component: OfficeRoute,
})

/** Map tenant → Office iframe origin. */
const OFFICE_URL: Record<string, string> = {
  henry_cos: 'https://office.berl.ai/',
  mally:     'https://mally-office.berl.ai/',
}

function resolveOfficeUrl(tenant: string | null): string {
  if (!tenant) {
    console.warn('[office] tenant unknown — falling back to henry_cos Office URL')
    return OFFICE_URL.henry_cos
  }
  const url = OFFICE_URL[tenant]
  if (!url) {
    console.warn(`[office] no Office URL configured for tenant "${tenant}" — falling back to henry_cos`)
    return OFFICE_URL.henry_cos
  }
  return url
}

function OfficeRoute() {
  usePageTitle('Office')
  const [loaded, setLoaded] = useState(false)
  const { tenant, loading } = useTenantRole()

  // While tenant is resolving, keep loaded=false so skeleton stays up
  const iframeSrc = resolveOfficeUrl(loading ? null : tenant)

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface">
      {/* Loading skeleton — shown until iframe onLoad fires */}
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
          className="h-full w-full flex-1 border-0"
          onLoad={() => setLoaded(true)}
          style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
        />
      )}
    </div>
  )
}
