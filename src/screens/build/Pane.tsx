/**
 * Pane — single cockpit pane with header (type dropdown + long-context toggle + close),
 * body (renders chosen tile), and status bar (idle/thinking/tool).
 */
import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, AlertCircleIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { PaneState, PaneType } from '@/stores/cockpit-store'
import { useCockpitStore } from '@/stores/cockpit-store'
import { CCPaneTile } from './tiles/CCPaneTile'
import { HermesChatTile } from './tiles/HermesChatTile'
import { VoiceTile } from './tiles/VoiceTile'
import { FlowDetailTile } from './tiles/FlowDetailTile'

const TYPE_LABELS: Record<PaneType, string> = {
  cc: 'Claude Code',
  hermes: 'Hermes Chat',
  voice: 'Voice',
  flow: 'Flow Detail',
}

type PaneProps = {
  pane: PaneState
  index: number
  /** Whether there is an active CC session in this pane (for confirm-on-close). */
  hasActiveSession?: boolean
}

export function Pane({ pane, index, hasActiveSession = false }: PaneProps) {
  const updatePane = useCockpitStore((s) => s.updatePane)
  const removePane = useCockpitStore((s) => s.removePane)
  const count = useCockpitStore((s) => s.count)

  const [longContextWarning, setLongContextWarning] = useState(false)

  function handleTypeChange(type: PaneType) {
    updatePane(pane.id, { type })
  }

  function handleClose() {
    if (hasActiveSession) {
      const confirmed = window.confirm(
        `Pane ${index + 1} has an active session. Close it?`,
      )
      if (!confirmed) return
    }
    removePane(pane.id)
  }

  function handleLongContextToggle(checked: boolean) {
    if (checked) {
      // Show billing warning once
      setLongContextWarning(true)
    }
    updatePane(pane.id, { longContext: checked })
  }

  function handleProfileChange(profileKey: string) {
    updatePane(pane.id, { profileKey })
  }

  function handleSessionSpawned(sessionId: string) {
    updatePane(pane.id, { sessionId })
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded border border-primary-300 bg-primary-50">
      {/* Pane header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-primary-300 bg-primary-100 px-2 py-1">
        {/* Type selector */}
        <select
          value={pane.type}
          onChange={(e) => handleTypeChange(e.target.value as PaneType)}
          className="flex-1 rounded border-0 bg-transparent text-xs font-medium text-primary-800 focus:outline-none"
          aria-label={`Pane ${index + 1} type`}
        >
          {(Object.keys(TYPE_LABELS) as Array<PaneType>).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        {/* Long-context toggle — CC panes only */}
        {pane.type === 'cc' ? (
          <label
            className="flex cursor-pointer items-center gap-1 select-none"
            title="Enable 1M context window (may incur Extra Usage charges)"
          >
            <input
              type="checkbox"
              checked={pane.longContext}
              onChange={(e) => handleLongContextToggle(e.target.checked)}
              className="accent-amber-400"
            />
            <span className="text-[10px] text-primary-500">1M</span>
            {pane.longContext ? (
              <HugeiconsIcon
                icon={AlertCircleIcon}
                size={12}
                strokeWidth={2}
                className="text-amber-400"
                title="Extra Usage charges may apply"
              />
            ) : null}
          </label>
        ) : null}

        {/* Close button — only show when count > 1 */}
        {count > 1 ? (
          <button
            type="button"
            onClick={handleClose}
            aria-label={`Close pane ${index + 1}`}
            className="rounded p-0.5 text-primary-500 hover:bg-primary-200 hover:text-primary-900 transition-colors"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {/* Long-context billing warning banner */}
      {longContextWarning && pane.longContext ? (
        <div className="flex shrink-0 items-center gap-2 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-600">
          <HugeiconsIcon
            icon={AlertCircleIcon}
            size={14}
            strokeWidth={2}
          />
          <span>
            1M context active — may incur{' '}
            <strong>Extra Usage charges</strong>.
          </span>
          <button
            type="button"
            onClick={() => setLongContextWarning(false)}
            className="ml-auto text-amber-400 hover:text-amber-600"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Pane body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {pane.type === 'cc' ? (
          <CCPaneTile
            paneId={pane.id}
            sessionId={pane.sessionId}
            accountKey={pane.accountKey}
            workdir={pane.workdir}
            longContext={pane.longContext}
            onSessionSpawned={handleSessionSpawned}
          />
        ) : pane.type === 'hermes' ? (
          <HermesChatTile
            profileKey={pane.profileKey}
            onProfileChange={handleProfileChange}
          />
        ) : pane.type === 'voice' ? (
          <VoiceTile />
        ) : (
          <FlowDetailTile paneId={pane.id} />
        )}
      </div>

      {/* Pane status bar */}
      <div className="flex shrink-0 items-center gap-2 border-t border-primary-300 bg-primary-100 px-2 py-0.5">
        <span
          className={cn(
            'size-1.5 rounded-full',
            pane.sessionId ? 'bg-emerald-400' : 'bg-primary-400',
          )}
        />
        <span className="text-[10px] text-primary-500">
          {pane.sessionId
            ? `Session: ${pane.sessionId.slice(0, 8)}…`
            : pane.type === 'cc'
              ? 'idle'
              : TYPE_LABELS[pane.type]}
        </span>
      </div>
    </div>
  )
}
