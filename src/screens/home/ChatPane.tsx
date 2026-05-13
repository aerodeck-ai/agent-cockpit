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
      const sourceFriendlyId = activeFriendlyId
      const sourceSessionKey = forcedSessionKey ?? activeFriendlyId

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
            embedded={true}
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
