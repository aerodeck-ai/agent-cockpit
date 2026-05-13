/**
 * VoiceScreen — push-to-talk + conversational voice interface.
 *
 * Pipeline:
 *   hold PTT → MediaRecorder captures audio → release → POST /api/voice/transcribe
 *   → POST /api/voice/chat (streaming) → POST /api/voice/speak → AudioContext playback
 *
 * Graceful fallbacks:
 *   - STT unreachable → browser SpeechRecognition
 *   - TTS unreachable → browser SpeechSynthesis
 */
import {
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Mic01Icon,
  StopIcon,
  AlertCircleIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { useMediaRecorder } from './hooks/use-media-recorder'
import { useAudioPlayer } from './hooks/use-audio-player'

// ─── Types ──────────────────────────────────────────────────────────────────

type PipelineState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'
type VoiceProfile = 'george' | 'henry-clone' | 'piper'

interface Turn {
  id: string
  role: 'user' | 'assistant'
  text: string
  toolCalls?: string[]
}

// ─── Browser STT fallback ────────────────────────────────────────────────────

function useBrowserStt(): ((onResult: (text: string) => void) => void) | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!SR) return null
  return (onResult) => {
    const rec = new SR() as SpeechRecognition
    rec.lang = 'en-GB'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const t = e.results[e.results.length - 1][0].transcript.trim()
      if (t) onResult(t)
    }
    rec.start()
  }
}

// ─── Browser TTS fallback ────────────────────────────────────────────────────

function speakBrowser(text: string) {
  if (typeof window === 'undefined') return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-GB'
  utt.rate = 1.1
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find(
    (v) => v.name.includes('Daniel') || v.name.includes('Google UK English'),
  )
  if (preferred) utt.voice = preferred
  window.speechSynthesis.speak(utt)
}

// ─── VoiceScreen ─────────────────────────────────────────────────────────────

const PROFILE_LABELS: Record<VoiceProfile, string> = {
  'george': 'George (Jarvis)',
  'henry-clone': 'Henry clone',
  'piper': 'Piper (local)',
}

export function VoiceScreen() {
  const [pipelineState, setPipelineState] = useState<PipelineState>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [notification, setNotification] = useState<string | null>(null)
  const [voiceProfile, setVoiceProfile] = useState<VoiceProfile>('george')
  const [showSettings, setShowSettings] = useState(false)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  const { play: playAudio, stop: stopAudio } = useAudioPlayer()
  const browserStt = useBrowserStt()

  // Auto-scroll to bottom of transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  const showNotif = useCallback((msg: string, duration = 4_000) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), duration)
  }, [])

  const addTurn = useCallback((role: Turn['role'], text: string, toolCalls?: string[]) => {
    setTurns((prev) => [...prev, { id: crypto.randomUUID(), role, text, toolCalls }])
  }, [])

  // ── STT ───────────────────────────────────────────────────────────────────
  const transcribeBlob = useCallback(
    async (blob: Blob): Promise<string> => {
      setPipelineState('transcribing')
      try {
        const resp = await fetch('/api/voice/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm' },
          body: blob,
        })
        if (!resp.ok) throw new Error(`STT HTTP ${resp.status}`)
        const data = await resp.json() as { text?: string; ok?: boolean; error?: string }
        return (data.text ?? '').trim()
      } catch (err) {
        // Graceful fallback: browser SpeechRecognition
        if (browserStt) {
          showNotif('STT service unavailable — using browser speech recognition')
          return await new Promise<string>((resolve) => {
            browserStt((text) => resolve(text))
          })
        }
        throw err
      }
    },
    [browserStt, showNotif],
  )

  // ── LLM ───────────────────────────────────────────────────────────────────
  const chatStream = useCallback(async (userText: string): Promise<string> => {
    setPipelineState('thinking')
    const resp = await fetch('/api/voice/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: userText }),
    })
    if (!resp.ok) throw new Error(`Chat HTTP ${resp.status}`)

    const reader = resp.body?.getReader()
    if (!reader) throw new Error('No stream body')

    const decoder = new TextDecoder()
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      // SSE lines: "data: {...}" or "data: [DONE]"
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (payload === '[DONE]') break
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
          }
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) full += delta
        } catch {
          // malformed chunk — ignore
        }
      }
    }

    return full.trim()
  }, [])

  // ── TTS ───────────────────────────────────────────────────────────────────
  const speak = useCallback(
    async (text: string) => {
      setPipelineState('speaking')
      const voiceRef = voiceProfile === 'george' ? 'henry' : voiceProfile === 'piper' ? 'piper' : 'henry'

      try {
        const resp = await fetch('/api/voice/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice_ref: voiceRef }),
        })

        if (resp.status === 503 || !resp.ok) {
          showNotif('TTS service unavailable — using browser voice')
          speakBrowser(text)
          setPipelineState('idle')
          return
        }

        const buf = await resp.arrayBuffer()
        await playAudio(buf)
      } catch {
        showNotif('TTS failed — using browser voice')
        speakBrowser(text)
      } finally {
        setPipelineState('idle')
      }
    },
    [voiceProfile, playAudio, showNotif],
  )

  // ── Full pipeline on blob ─────────────────────────────────────────────────
  const onBlob = useCallback(
    async (blob: Blob) => {
      stopAudio()
      let userText: string
      try {
        userText = await transcribeBlob(blob)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transcription failed'
        showNotif(`Transcription error: ${msg}`)
        setPipelineState('idle')
        return
      }

      if (!userText) {
        showNotif('Nothing detected — try again')
        setPipelineState('idle')
        return
      }

      addTurn('user', userText)

      let assistantText: string
      try {
        assistantText = await chatStream(userText)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'LLM error'
        showNotif(`LLM error: ${msg}`)
        setPipelineState('idle')
        return
      }

      if (!assistantText) {
        showNotif('No reply from assistant')
        setPipelineState('idle')
        return
      }

      addTurn('assistant', assistantText)
      await speak(assistantText)
    },
    [transcribeBlob, chatStream, speak, addTurn, showNotif, stopAudio],
  )

  const { state: recState, error: recError, start: startRec, stop: stopRec, cancel: cancelRec } = useMediaRecorder({ onBlob })

  const handlePttDown = useCallback(
    async (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      if (pipelineState !== 'idle') return
      stopAudio()
      await startRec()
      setPipelineState('recording')
    },
    [pipelineState, stopAudio, startRec],
  )

  const handlePttUp = useCallback(() => {
    if (recState === 'recording') {
      stopRec()
      // pipelineState transitions to 'transcribing' via onBlob
    }
  }, [recState, stopRec])

  const handlePttCancel = useCallback(() => {
    cancelRec()
    setPipelineState('idle')
  }, [cancelRec])

  // ── Derived UI ───────────────────────────────────────────────────────────
  const isRecording = recState === 'recording'
  const isBusy = pipelineState !== 'idle' && pipelineState !== 'recording'

  const stateLabel: Record<PipelineState, string> = {
    idle: 'Hold to speak',
    recording: 'Listening…',
    transcribing: 'Transcribing…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-surface)] text-[var(--color-ink)]">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-primary-200)] px-4 py-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Mic01Icon} size={18} strokeWidth={1.5} className="text-accent-500" />
          <span className="text-sm font-semibold tracking-wide">Voice</span>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((v) => !v)}
          className="rounded-lg p-1.5 transition-colors hover:bg-[var(--color-primary-100)]"
          aria-label="Voice settings"
        >
          <HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.5} />
        </button>
      </div>

      {/* ── Settings Panel ─────────────────────────────────────────────── */}
      {showSettings && (
        <div className="shrink-0 border-b border-[var(--color-primary-200)] bg-[var(--color-primary-50)] px-4 py-3">
          <p className="mb-2 text-xs font-medium text-[var(--color-primary-600)]">Voice profile</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PROFILE_LABELS) as VoiceProfile[]).map((p) => (
              <button
                key={p}
                type="button"
                disabled={p === 'henry-clone'}
                onClick={() => setVoiceProfile(p)}
                className={cn(
                  'rounded-lg border px-3 py-1 text-xs transition-colors',
                  voiceProfile === p
                    ? 'border-accent-500 bg-accent-500/10 text-accent-600 dark:text-accent-400'
                    : 'border-[var(--color-primary-200)] text-[var(--color-primary-600)] hover:border-accent-400',
                  p === 'henry-clone' && 'cursor-not-allowed opacity-40',
                )}
                title={p === 'henry-clone' ? 'Henry clone voice coming soon' : undefined}
              >
                {PROFILE_LABELS[p]}
              </button>
            ))}
          </div>
          {/* Path B toggle stub */}
          <div className="mt-3 flex items-center gap-2 opacity-40" title="coming soon — requires OpenAI Realtime API">
            <div className="h-4 w-8 rounded-full bg-[var(--color-primary-300)]" />
            <span className="text-xs text-[var(--color-primary-600)]">Low-latency mode (gpt-realtime-2)</span>
            <span className="rounded bg-[var(--color-primary-200)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-primary-500)]">coming soon</span>
          </div>
        </div>
      )}

      {/* ── Notification Banner ─────────────────────────────────────────── */}
      {notification && (
        <div className="flex shrink-0 items-center gap-2 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-700 dark:text-yellow-300">
          <HugeiconsIcon icon={AlertCircleIcon} size={14} strokeWidth={1.5} />
          {notification}
        </div>
      )}

      {/* ── Transcript ──────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-[var(--color-primary-500)]">
            <HugeiconsIcon icon={Mic01Icon} size={40} strokeWidth={1} className="opacity-20" />
            <p className="text-sm">Hold the button below to start speaking.</p>
          </div>
        )}
        <div className="flex flex-col gap-4">
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={cn(
                'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                turn.role === 'user'
                  ? 'ml-auto bg-accent-500 text-white'
                  : 'bg-[var(--color-primary-100)] text-[var(--color-ink)]',
              )}
            >
              {turn.toolCalls && turn.toolCalls.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {turn.toolCalls.map((tc, i) => (
                    <span
                      key={i}
                      className="rounded bg-[var(--color-primary-200)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-primary-600)]"
                    >
                      {tc}
                    </span>
                  ))}
                </div>
              )}
              {turn.text}
            </div>
          ))}
        </div>
        <div ref={transcriptEndRef} />
      </div>

      {/* ── PTT Button + Status ─────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--color-primary-200)] px-4 py-6">
        {recError && (
          <p className="mb-3 text-center text-xs text-red-500">{recError}</p>
        )}
        <div className="flex flex-col items-center gap-3">
          <p className="text-xs text-[var(--color-primary-500)]">
            {stateLabel[pipelineState]}
          </p>

          {/* Big PTT circle */}
          <button
            type="button"
            disabled={isBusy}
            onPointerDown={(e) => void handlePttDown(e)}
            onPointerUp={handlePttUp}
            onPointerLeave={handlePttUp}
            onPointerCancel={handlePttCancel}
            className={cn(
              'relative flex h-20 w-20 touch-none select-none items-center justify-center rounded-full border-2 transition-all duration-150',
              isRecording
                ? 'scale-110 border-red-500 bg-red-500 shadow-[0_0_0_8px_rgba(239,68,68,0.15)]'
                : isBusy
                ? 'cursor-not-allowed border-[var(--color-primary-300)] bg-[var(--color-primary-100)] opacity-60'
                : 'border-accent-500 bg-accent-500/10 hover:bg-accent-500/20 active:scale-95 cursor-pointer',
            )}
            aria-label={isRecording ? 'Release to send' : 'Hold to record'}
          >
            {isRecording ? (
              <HugeiconsIcon icon={StopIcon} size={28} strokeWidth={1.5} className="text-white" />
            ) : (
              <HugeiconsIcon
                icon={Mic01Icon}
                size={32}
                strokeWidth={1.5}
                className={isBusy ? 'text-[var(--color-primary-400)]' : 'text-accent-500'}
              />
            )}

            {/* Ripple when recording */}
            {isRecording && (
              <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-30" />
            )}
          </button>

          {/* Pipeline spinner dots */}
          {isBusy && (
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-500"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
