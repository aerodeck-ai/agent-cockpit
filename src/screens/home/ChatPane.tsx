/**
 * ChatPane — embeds the existing Hermes chat on the Home page.
 *
 * Wraps the same ChatScreen component that /chat/$sessionKey uses.
 * Restores last active session from localStorage, same as /chat/index.tsx.
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ErrorBoundary } from '@/components/error-boundary'
import {
  moveHistoryMessages,
  reconcileSessionDraft,
} from '@/screens/chat/chat-queries'

const ChatScreen = lazy(async () => {
  const module = await import('@/screens/chat/chat-screen')
  return { default: module.ChatScreen }
})

function resolveInitialSession(): string {
  try {
    if (typeof window === 'undefined') return 'new'
    const stored = localStorage.getItem('claude-last-session')
    if (stored && stored !== 'main') return stored
  } catch {}
  return 'new'
}

export function ChatPane() {
  const [mounted, setMounted] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [activeFriendlyId, setActiveFriendlyId] = useState<string>('new')
  const [forcedSession, setForcedSession] = useState<{
    friendlyId: string
    sessionKey: string
  } | null>(null)

  useEffect(() => {
    setActiveFriendlyId(resolveInitialSession())
    setMounted(true)
  }, [])

  const isNewChat = activeFriendlyId === 'new'
  const forcedSessionKey =
    forcedSession?.friendlyId === activeFriendlyId
      ? forcedSession.sessionKey
      : undefined

  const handleSessionResolved = useCallback(
    (payload: { friendlyId: string; sessionKey: string }) => {
      // Bug fix: when a new chat sends its first message, ChatScreen uses a
      // random UUID threadId (not 'new') as the cache key for the optimistic
      // message. ChatPane's activeFriendlyId is still 'new' at this point, so
      // hardcoding the source as 'new'/'new' misses the actual cache entry.
      // Solution: scan all history cache entries and find the one containing
      // optimistic (in-flight) messages — that is the real source to move.
      const historyQueries = queryClient.getQueriesData<{ messages?: unknown[] }>({
        queryKey: ['chat', 'history'],
      })
      let sourceFriendlyId = activeFriendlyId
      let sourceSessionKey = forcedSessionKey ?? activeFriendlyId
      for (const [queryKey, data] of historyQueries) {
        const messages = Array.isArray(data?.messages) ? data.messages : []
        const hasOptimistic = messages.some((m: unknown) => {
          const raw = m as Record<string, unknown>
          return (
            raw.role === 'user' &&
            (raw.status === 'sending' ||
              (typeof raw.__optimisticId === 'string' && raw.__optimisticId.length > 0) ||
              (typeof raw.clientId === 'string' && raw.clientId.length > 0))
          )
        })
        if (hasOptimistic && Array.isArray(queryKey) && queryKey.length >= 4) {
          // queryKey shape: ['chat', 'history', friendlyId, sessionKey]
          sourceFriendlyId = String(queryKey[2])
          sourceSessionKey = String(queryKey[3])
          break
        }
      }

      moveHistoryMessages(
        queryClient,
        sourceFriendlyId,
        sourceSessionKey,
        payload.friendlyId,
        payload.sessionKey,
      )
      reconcileSessionDraft(
        queryClient,
        sourceFriendlyId,
        sourceSessionKey,
        payload.friendlyId,
        payload.sessionKey,
      )
      queryClient.invalidateQueries({ queryKey: ['chat', 'sessions'] })
      setForcedSession({
        friendlyId: payload.friendlyId,
        sessionKey: payload.sessionKey,
      })

      try {
        localStorage.setItem('claude-last-session', payload.friendlyId)
      } catch {}

      setActiveFriendlyId(payload.friendlyId)
    },
    [activeFriendlyId, forcedSessionKey, queryClient],
  )

  if (!mounted) {
    return (
      <div className="chat-pane chat-pane-loading">
        <span>Loading chat…</span>
      </div>
    )
  }

  return (
    <div className="chat-pane">
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="chat-pane chat-pane-loading">
              <span>Loading chat…</span>
            </div>
          }
        >
          <ChatScreen
            activeFriendlyId={activeFriendlyId}
            isNewChat={isNewChat}
            forcedSessionKey={forcedSessionKey}
            // FIX 2026-05-13: embedded=false so ChatScreen navigates to
            // /chat/$sessionKey on first send. Embedded mode suppressed
            // the navigate, leaving isNewChat=true forever, which made
            // useRealtimeChatHistory read streamingState['new'] while
            // chunks dispatched under streamingState[resolved-uuid].
            embedded={false}
            onSessionResolved={
              isNewChat || activeFriendlyId === 'main'
                ? handleSessionResolved
                : undefined
            }
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}
