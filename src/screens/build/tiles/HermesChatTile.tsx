/**
 * HermesChatTile — embeds Hermes chat scoped to a picked profile.
 *
 * Renders an iframe pointing to /chat?profile=<profileKey> so it inherits
 * the full Hermes chat UI without duplicating logic.
 */
import { useState } from 'react'
import { cn } from '@/lib/utils'

const PROFILE_OPTIONS = [
  { value: 'cos', label: 'Chief of Staff' },
  { value: 'personal', label: 'Personal' },
  { value: 'mally', label: 'Mally' },
  { value: 'ares', label: 'Ares (Security)' },
  { value: 'yt-strategist', label: 'YT Strategist' },
]

type HermesChatTileProps = {
  profileKey?: string
  onProfileChange?: (profileKey: string) => void
}

export function HermesChatTile({
  profileKey = 'cos',
  onProfileChange,
}: HermesChatTileProps) {
  const [selected, setSelected] = useState(profileKey)

  function handleChange(value: string) {
    setSelected(value)
    onProfileChange?.(value)
  }

  return (
    <div className="flex h-full flex-col">
      {/* Profile picker sub-header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-primary-300 bg-primary-100 px-3 py-1.5">
        <span className="text-xs text-primary-500">Profile:</span>
        <select
          value={selected}
          onChange={(e) => handleChange(e.target.value)}
          className="rounded border border-primary-300 bg-primary-50 px-2 py-0.5 text-xs text-primary-800 focus:outline-none"
        >
          {PROFILE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className={cn('relative flex-1 overflow-hidden')}>
        <iframe
          key={selected}
          src={`/?profile=${selected}`}
          className="h-full w-full border-none"
          title={`Hermes — ${selected}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  )
}
