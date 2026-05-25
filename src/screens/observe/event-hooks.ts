/**
 * useEventStream — SSE hook for the /observe Flow tab.
 *
 * Connects to /api/sse/events?tenant=<tenant>&window=<seconds>
 * Returns events, pause state, and filter state.
 *
 * Reconnects automatically on disconnect (exponential back-off, max 30s).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export type HookEvent = {
  source_app: string
  session_id: string
  parent_session_id?: string
  hook_event_type:
    | 'PreToolUse'
    | 'PostToolUse'
    | 'SubagentStop'
    | 'Stop'
    | 'SubagentStart'
    | 'SessionStart'
    | 'SessionEnd'
    | 'PreCompact'
    | 'UserPromptSubmit'
    | 'Notification'
    | string
  payload: {
    tool_name?: string
    tool_input?: Record<string, unknown>
    tool_response?: unknown
    duration_ms?: number
    [key: string]: unknown
  }
  timestamp: number // ms since epoch
  id?: string | number
  summary?: string
  model_name?: string
}

export type EventFilters = {
  sourceApp: string
  sessionId: string
  eventType: string
  toolName: string
}

export type UseEventStreamResult = {
  events: HookEvent[]
  paused: boolean
  setPaused: (p: boolean) => void
  filters: EventFilters
  setFilters: (f: EventFilters) => void
  connected: boolean
  error: string | null
  clearEvents: () => void
}

const DEFAULT_FILTERS: EventFilters = {
  sourceApp: '',
  sessionId: '',
  eventType: '',
  toolName: '',
}

const MAX_EVENTS = 500
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useEventStream(
  tenant: string = '',
  windowSeconds: number = 300,
): UseEventStreamResult {
  const [events, setEvents] = useState<HookEvent[]>([])
  const [paused, setPaused] = useState(false)
  const [filters, setFilters] = useState<EventFilters>(DEFAULT_FILTERS)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const esRef = useRef<EventSource | null>(null)
  const retryCount = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  const clearEvents = useCallback(() => setEvents([]), [])

  useEffect(() => {
    mounted.current = true

    function connect() {
      if (!mounted.current) return

      const params = new URLSearchParams()
      if (tenant) params.set('tenant', tenant)
      if (windowSeconds) params.set('window', String(windowSeconds))

      const url = `/api/sse/events?${params.toString()}`
      const es = new EventSource(url)
      esRef.current = es

      es.addEventListener('connected', () => {
        if (!mounted.current) return
        setConnected(true)
        setError(null)
        retryCount.current = 0
      })

      es.addEventListener('hook_event', (e: MessageEvent) => {
        if (!mounted.current) return
        if (pausedRef.current) return
        try {
          const evt = JSON.parse(e.data) as HookEvent
          setEvents((prev) => {
            const next = [...prev, evt]
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
          })
        } catch {
          // malformed JSON — skip
        }
      })

      // Also handle generic 'message' events (for JSONL fallback)
      es.onmessage = (e: MessageEvent) => {
        if (!mounted.current) return
        if (pausedRef.current) return
        try {
          const evt = JSON.parse(e.data) as HookEvent
          if (evt.source_app && evt.hook_event_type) {
            setEvents((prev) => {
              const next = [...prev, evt]
              return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next
            })
          }
        } catch {
          // ignore
        }
      }

      es.onerror = () => {
        if (!mounted.current) return
        setConnected(false)
        es.close()
        esRef.current = null

        // Exponential back-off
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, retryCount.current),
          RECONNECT_MAX_MS,
        )
        retryCount.current += 1
        setError(`SSE disconnected — reconnecting in ${Math.round(delay / 1000)}s…`)
        retryTimer.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      mounted.current = false
      esRef.current?.close()
      esRef.current = null
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [tenant, windowSeconds])

  return {
    events,
    paused,
    setPaused,
    filters,
    setFilters,
    connected,
    error,
    clearEvents,
  }
}

// ── Colour helpers (ported from disler's useEventColors composable) ───────────

/**
 * djb2-inspired hash with improved distribution.
 * Ported from disler/claude-code-hooks-multi-agent-observability:
 *   apps/client/src/composables/useEventColors.ts
 */
function hashString(str: string | undefined | null): number {
  if (!str) return 0
  let hash = 7151
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i)
  }
  return Math.abs(hash >>> 0)
}

/**
 * Maps a source_app name to a consistent HSL hex colour.
 * Ported from disler's getHexColorForApp.
 */
export function getHexColorForApp(appName: string): string {
  const hue = hashString(appName) % 360
  return `hsl(${hue}, 70%, 50%)`
}

/**
 * Maps a session_id to one of the tailwind palette colours.
 * Ported from disler's getColorForSession.
 */
export function getHexColorForSession(sessionId: string): string {
  const palette = [
    '#3B82F6', '#22C55E', '#EAB308', '#A855F7',
    '#EC4899', '#6366F1', '#EF4444', '#F97316',
    '#14B8A6', '#06B6D4',
  ]
  const idx = hashString(sessionId) % palette.length
  return palette[idx]
}

// ── Emoji helpers (ported from disler's useEventEmojis composable) ──────────

const TOOL_EMOJIS: Record<string, string> = {
  Bash: '💻', Read: '📖', Write: '✍️', Edit: '✏️',
  WebFetch: '🌐', WebSearch: '🔍', mcp__: '🔌',
  Task: '🤖', Skill: '🎯', TodoWrite: '📝', TodoRead: '📋',
}

export function getEmojiForTool(toolName: string): string {
  for (const [key, emoji] of Object.entries(TOOL_EMOJIS)) {
    if (toolName.startsWith(key)) return emoji
  }
  return '🔧'
}

const HOOK_EMOJIS: Record<string, string> = {
  PreToolUse: '🔧', PostToolUse: '✅', SubagentStop: '👥',
  SubagentStart: '🟢', Stop: '🛑', SessionStart: '🚀',
  SessionEnd: '🏁', PreCompact: '📦', UserPromptSubmit: '💬',
  Notification: '🔔',
}

export function getEmojiForEventType(type: string): string {
  return HOOK_EMOJIS[type] ?? '❓'
}
