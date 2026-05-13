/**
 * RelayWidget — sidebar widget showing recent warroom activity from relay.db.
 *
 * Displays last 10 warroom sessions filtered by the current tenant.
 * Uses the /api/relay/messages API route.
 */

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface WarroomSession {
  id: number
  started_at: string
  initiator: string
  kind: string
  topic: string | null
  ended_at: string | null
  reply_count: number
}

interface RelayMessagesResponse {
  schema_status: 'ok' | 'unknown' | 'error'
  messages: WarroomSession[]
  reason?: string
}

export function RelayWidget({ className }: { className?: string }) {
  const [data, setData] = useState<RelayMessagesResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/relay/messages')
      .then((r) => r.json())
      .then((d: RelayMessagesResponse) => { setData(d); setLoading(false) })
      .catch(() => { setData({ schema_status: 'error', messages: [], reason: 'fetch_failed' }); setLoading(false) })
  }, [])

  if (loading) {
    return (
      <div className={cn('p-3 text-xs text-muted-foreground', className)}>
        Loading warroom…
      </div>
    )
  }

  if (!data || data.schema_status !== 'ok' || data.messages.length === 0) {
    return (
      <div className={cn('p-3 text-xs text-muted-foreground', className)}>
        No warroom activity
        {data?.reason ? ` (${data.reason})` : ''}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1 p-2', className)}>
      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        Warroom
      </div>
      {data.messages.map((session) => (
        <div
          key={session.id}
          className="flex flex-col gap-0.5 rounded px-2 py-1.5 bg-muted/40 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate max-w-[160px]">
              {session.topic ?? `${session.kind} session`}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {session.reply_count} replies
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {new Date(session.started_at).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
            {session.ended_at ? '' : ' · ongoing'}
          </div>
        </div>
      ))}
    </div>
  )
}
