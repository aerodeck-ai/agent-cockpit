/**
 * FlowTab — Live hook-event stream viewer for the /observe page.
 *
 * Adapted from disler/claude-code-hooks-multi-agent-observability:
 *   apps/client/src/components/EventList.vue  (EventTimeline.vue)
 *   apps/client/src/components/EventRow.vue
 *   apps/client/src/components/FilterBar.vue  (FilterPanel.vue)
 *
 * Source repo: /Volumes/InfraSSD/oss-study/claude-code-hooks-multi-agent-observability
 *
 * Faithfully ports:
 *   - Scrollable event list with auto-scroll / sticky-bottom
 *   - Per-source-app colour dot (consistent hash → HSL colour)
 *   - Filter chips: source_app / session_id / event_type / tool_name
 *   - Pause / play button
 *   - Click row → JSON payload modal
 *   - Empty state
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { EventFilters, HookEvent } from './event-hooks'
import {
  getEmojiForEventType,
  getEmojiForTool,
  getHexColorForApp,
  getHexColorForSession,
  useEventStream,
} from './event-hooks'

// ── FilterBar ────────────────────────────────────────────────────────────────
// Ported from disler FilterPanel.vue

interface FilterBarProps {
  events: HookEvent[]
  filters: EventFilters
  onFiltersChange: (f: EventFilters) => void
  paused: boolean
  onPausedChange: (p: boolean) => void
  onClear: () => void
  connected: boolean
  error: string | null
}

function FilterBar({
  events,
  filters,
  onFiltersChange,
  paused,
  onPausedChange,
  onClear,
  connected,
  error,
}: FilterBarProps) {
  // Derive unique values from live event list
  const sourceApps = useMemo(
    () => [...new Set(events.map((e) => e.source_app))].sort(),
    [events],
  )
  const sessionIds = useMemo(
    () => [...new Set(events.map((e) => e.session_id).filter(Boolean))].sort(),
    [events],
  )
  const eventTypes = useMemo(
    () => [...new Set(events.map((e) => e.hook_event_type).filter(Boolean))].sort(),
    [events],
  )
  const toolNames = useMemo(
    () =>
      [
        ...new Set(
          events
            .map((e) => e.payload?.tool_name)
            .filter((t): t is string => Boolean(t)),
        ),
      ].sort(),
    [events],
  )

  const hasFilters =
    filters.sourceApp || filters.sessionId || filters.eventType || filters.toolName

  function update(patch: Partial<EventFilters>) {
    onFiltersChange({ ...filters, ...patch })
  }

  return (
    <div className="border-b border-border bg-muted/20 px-4 py-2 flex flex-wrap items-center gap-2">
      {/* Connection status dot */}
      <div
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          connected ? 'bg-green-400' : 'bg-red-400 animate-pulse',
        )}
        title={connected ? 'SSE connected' : (error ?? 'disconnected')}
      />

      {/* Source App filter */}
      <select
        className="rounded border border-border bg-background px-2 py-1 text-xs"
        value={filters.sourceApp}
        onChange={(e) => update({ sourceApp: e.target.value })}
      >
        <option value="">pane ▾</option>
        {sourceApps.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      {/* Event Type filter */}
      <select
        className="rounded border border-border bg-background px-2 py-1 text-xs"
        value={filters.eventType}
        onChange={(e) => update({ eventType: e.target.value })}
      >
        <option value="">event-type ▾</option>
        {eventTypes.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {/* Tool filter */}
      <select
        className="rounded border border-border bg-background px-2 py-1 text-xs"
        value={filters.toolName}
        onChange={(e) => update({ toolName: e.target.value })}
      >
        <option value="">tool ▾</option>
        {toolNames.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {/* Session filter */}
      <select
        className="rounded border border-border bg-background px-2 py-1 text-xs font-mono"
        value={filters.sessionId}
        onChange={(e) => update({ sessionId: e.target.value })}
      >
        <option value="">session ▾</option>
        {sessionIds.map((s) => (
          <option key={s} value={s}>
            {s.slice(0, 8)}…
          </option>
        ))}
      </select>

      {/* Clear filters */}
      {hasFilters && (
        <button
          onClick={() =>
            onFiltersChange({
              sourceApp: '',
              sessionId: '',
              eventType: '',
              toolName: '',
            })
          }
          className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          clear
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Event count */}
      <span className="text-xs text-muted-foreground shrink-0">
        {events.length} events
      </span>

      {/* Clear all events */}
      <button
        onClick={onClear}
        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
        title="Clear all captured events"
      >
        clear all
      </button>

      {/* Pause / Play */}
      <button
        onClick={() => onPausedChange(!paused)}
        className={cn(
          'rounded border px-3 py-1 text-xs font-semibold shrink-0 transition-colors',
          paused
            ? 'border-amber-400/50 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
            : 'border-border text-muted-foreground hover:text-foreground',
        )}
        title={paused ? 'Resume stream' : 'Pause stream'}
      >
        {paused ? '▶ play' : '⏸ pause'}
      </button>
    </div>
  )
}

// ── Event Row ────────────────────────────────────────────────────────────────
// Ported from disler EventRow.vue

interface EventRowProps {
  event: HookEvent
  onClick: (e: HookEvent) => void
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function extractToolDetail(event: HookEvent): string {
  const { payload, hook_event_type: type } = event
  if (!payload) return ''

  if (type === 'UserPromptSubmit' && payload.prompt) {
    const p = String(payload.prompt)
    return `"${p.length > 60 ? p.slice(0, 60) + '…' : p}"`
  }
  if (payload.command) {
    const c = String(payload.command)
    return c.length > 60 ? c.slice(0, 60) + '…' : c
  }
  if (payload.file_path) {
    return String(payload.file_path).split('/').pop() ?? ''
  }
  if (payload.query) {
    const q = String(payload.query)
    return q.length > 50 ? q.slice(0, 50) + '…' : q
  }
  if (payload.url) {
    const u = String(payload.url)
    return u.length > 60 ? u.slice(0, 60) + '…' : u
  }
  return ''
}

/** Approximate duration bar: shows 3 blocks scaled to 0-10s. */
function DurationBar({ ms }: { ms?: number }) {
  if (!ms) return <span className="text-muted-foreground text-xs font-mono">—</span>
  const secs = ms / 1000
  const filled = Math.min(3, Math.round((secs / 10) * 3))
  const blocks = '▓'.repeat(filled) + '░'.repeat(3 - filled)
  return (
    <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
      {blocks} {secs.toFixed(1)}s
    </span>
  )
}

function EventRow({ event, onClick }: EventRowProps) {
  const appColor = getHexColorForApp(event.source_app)
  const sessionColor = getHexColorForSession(event.session_id)
  const emoji = getEmojiForEventType(event.hook_event_type)
  const toolEmoji = event.payload?.tool_name
    ? getEmojiForTool(event.payload.tool_name)
    : ''
  const detail = extractToolDetail(event)

  return (
    <button
      className="group w-full flex items-center gap-3 px-3 py-1.5 text-left hover:bg-muted/40 border-b border-border/30 transition-colors text-xs"
      onClick={() => onClick(event)}
      title="Click to inspect payload"
    >
      {/* Left colour strip — source_app colour */}
      <span
        className="shrink-0 w-2 h-2 rounded-full"
        style={{ backgroundColor: appColor }}
        title={event.source_app}
      />

      {/* Time */}
      <span className="shrink-0 font-mono text-muted-foreground w-16">
        {formatTime(event.timestamp)}
      </span>

      {/* Source app badge */}
      <span
        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold border"
        style={{
          borderColor: appColor,
          backgroundColor: appColor + '22',
          color: appColor,
        }}
      >
        {event.source_app}
      </span>

      {/* Session dot */}
      <span
        className="shrink-0 w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: sessionColor }}
        title={`session: ${event.session_id}`}
      />

      {/* Event type */}
      <span className="shrink-0 text-muted-foreground">
        {emoji} {event.hook_event_type}
      </span>

      {/* Tool name */}
      {event.payload?.tool_name && (
        <span className="shrink-0 font-mono rounded bg-muted px-1 py-0.5 text-[10px]">
          {toolEmoji} {event.payload.tool_name}
        </span>
      )}

      {/* Detail */}
      {detail && (
        <span className="flex-1 truncate text-muted-foreground italic">
          {detail}
        </span>
      )}

      {/* Duration */}
      <span className="ml-auto shrink-0">
        <DurationBar ms={event.payload?.duration_ms as number | undefined} />
      </span>
    </button>
  )
}

// ── Payload Modal ─────────────────────────────────────────────────────────────

function PayloadModal({
  event,
  onClose,
}: {
  event: HookEvent
  onClose: () => void
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const json = JSON.stringify(event, null, 2)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">
            {getEmojiForEventType(event.hook_event_type)} {event.hook_event_type}
          </span>
          <span className="text-xs text-muted-foreground">{event.source_app}</span>
          <span className="ml-auto text-xs font-mono text-muted-foreground">
            {formatTime(event.timestamp)}
          </span>
          <button
            onClick={onClose}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {/* JSON body */}
        <div className="overflow-y-auto p-4 max-h-[calc(80vh-48px)]">
          <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
            {json}
          </pre>
        </div>
      </div>
    </div>
  )
}

// ── FlowTab ──────────────────────────────────────────────────────────────────

export function FlowTab({ tenant = '' }: { tenant?: string }) {
  const { events, paused, setPaused, filters, setFilters, connected, error, clearEvents } =
    useEventStream(tenant)

  const [selectedEvent, setSelectedEvent] = useState<HookEvent | null>(null)
  const [stickyBottom, setStickyBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Apply filters
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (filters.sourceApp && e.source_app !== filters.sourceApp) return false
      if (filters.sessionId && e.session_id !== filters.sessionId) return false
      if (filters.eventType && e.hook_event_type !== filters.eventType) return false
      if (filters.toolName && e.payload?.tool_name !== filters.toolName) return false
      return true
    })
  }, [events, filters])

  // Auto-scroll when new events arrive and we're sticking to bottom
  useEffect(() => {
    if (!stickyBottom) return
    const el = scrollRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [filteredEvents.length, stickyBottom])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setStickyBottom(atBottom)
  }, [])

  const handleRowClick = useCallback((e: HookEvent) => {
    setSelectedEvent(e)
  }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <FilterBar
        events={events}
        filters={filters}
        onFiltersChange={setFilters}
        paused={paused}
        onPausedChange={setPaused}
        onClear={clearEvents}
        connected={connected}
        error={error}
      />

      {/* Error banner */}
      {error && !connected && (
        <div className="px-4 py-1.5 text-xs text-amber-300 bg-amber-400/10 border-b border-amber-400/20">
          {error}
        </div>
      )}

      {/* Scroll container */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={handleScroll}
      >
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <span className="text-4xl">🔳</span>
            <p className="text-sm font-semibold">No events to display</p>
            <p className="text-xs opacity-60">
              {connected
                ? 'Events will appear as they arrive from Claude hooks'
                : 'Waiting for SSE connection…'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/0">
            {filteredEvents.map((evt, i) => (
              <EventRow
                key={`${evt.session_id}-${evt.timestamp}-${i}`}
                event={evt}
                onClick={handleRowClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky-bottom indicator */}
      {!stickyBottom && (
        <button
          className="absolute bottom-4 right-4 z-10 rounded-full border border-border bg-background px-3 py-1 text-xs shadow-lg hover:bg-muted"
          onClick={() => {
            setStickyBottom(true)
            const el = scrollRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
        >
          ↓ live
        </button>
      )}

      {/* Payload modal */}
      {selectedEvent && (
        <PayloadModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  )
}
