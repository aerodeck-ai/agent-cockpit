import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { useState } from 'react'

export const Route = createFileRoute('/office')({
  ssr: false,
  component: OfficeRoute,
})

function OfficeRoute() {
  usePageTitle('Office')
  const [loaded, setLoaded] = useState(false)

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-surface">
      {/* Loading skeleton — shown until iframe onLoad fires */}
      {!loaded && (
        <div className="absolute inset-0 z-10 flex flex-col gap-3 p-4 animate-pulse">
          <div className="h-10 w-full rounded-md bg-primary-100/60 dark:bg-primary-800/40" />
          <div className="h-6 w-2/3 rounded bg-primary-100/60 dark:bg-primary-800/40" />
          <div className="flex-1 rounded-lg bg-primary-100/40 dark:bg-primary-800/30" />
        </div>
      )}
      <iframe
        src="https://office.berl.ai/"
        title="Claw3D Office"
        allow="microphone; clipboard-read; clipboard-write"
        className="h-full w-full flex-1 border-0"
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />
    </div>
  )
}
