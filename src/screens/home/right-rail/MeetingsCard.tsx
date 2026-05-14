/**
 * MeetingsCard — right-rail card showing today's meetings from vectos.
 *
 * Tries GET https://vectos.berl.ai/api/meetings/today first.
 * If that returns 404, falls back to embedding vectos /meetings as an iframe.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

type Meeting = {
  id: string | number
  title: string
  start_time?: string | null
  end_time?: string | null
  attendees?: string[] | null
  action_items?: string[] | null
}

type MeetingsResponse = {
  meetings?: Meeting[]
  data?: Meeting[]
}

function formatTime(t: string): string {
  try {
    return new Date(t).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return t
  }
}

export function MeetingsCard() {
  const [useIframe, setUseIframe] = useState(false)

  const { data, isLoading, error } = useQuery<MeetingsResponse>({
    queryKey: ['vectos', 'meetings-today'],
    queryFn: async () => {
      // Use server-side proxy to bypass CF Access CORS restriction
      const resp = await fetch('/api/meetings')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const body = await resp.json() as { meetings?: Meeting[]; data?: Meeting[]; source?: string }
      // proxy returns source:"vectos_404" when the upstream endpoint is not yet implemented
      if (body.source === 'vectos_404') {
        setUseIframe(true)
        return { meetings: [] }
      }
      return body
    },
    refetchInterval: 10 * 60_000,
    staleTime: 9 * 60_000,
    retry: 1,
  })

  const meetings: Meeting[] = data?.meetings ?? data?.data ?? []

  if (useIframe) {
    return (
      <div className="home-rail-card meetings-iframe-card">
        <div className="home-rail-card-header">
          <span className="home-rail-card-title">Today's meetings</span>
        </div>
        <iframe
          src="https://vectos.berl.ai/meetings"
          title="Today's meetings"
          className="meetings-iframe"
          loading="lazy"
        />
      </div>
    )
  }

  return (
    <div className="home-rail-card">
      <div className="home-rail-card-header">
        <span className="home-rail-card-title">Today's meetings</span>
        {!isLoading && (
          <span className="home-rail-card-badge">{meetings.length}</span>
        )}
      </div>

      {isLoading && (
        <div className="home-rail-skeleton">
          <div className="home-rail-skeleton-row" />
          <div className="home-rail-skeleton-row short" />
        </div>
      )}

      {!isLoading && error && (
        <p className="home-rail-error">
          vectos unreachable
        </p>
      )}

      {!isLoading && !error && meetings.length === 0 && (
        <p className="home-rail-empty">No meetings today</p>
      )}

      {!isLoading && !error && meetings.length > 0 && (
        <ul className="home-rail-list">
          {meetings.map((m) => (
            <li key={m.id} className="home-rail-list-item meetings-item">
              <div className="meetings-item-row">
                {m.start_time && (
                  <span className="home-rail-item-age meeting-time">
                    {formatTime(m.start_time)}
                  </span>
                )}
                <span className="home-rail-item-title">{m.title}</span>
              </div>
              {m.action_items && m.action_items.length > 0 && (
                <div className="meetings-actions">
                  → {m.action_items.length} action{m.action_items.length !== 1 ? 's' : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
