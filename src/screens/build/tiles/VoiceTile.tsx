/**
 * VoiceTile — PTT button + transcript area.
 *
 * Uses existing /api/voice/* endpoints (same as /voice page).
 * Simplified single-pane version of VoiceScreen.
 */
import { useCallback, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Mic01Icon, StopIcon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

type Turn = { id: string; role: 'user' | 'assistant'; text: string }

type PipelineState = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'

const STATE_LABEL: Record<PipelineState, string> = {
  idle: 'Hold to talk',
  recording: 'Recording…',
  transcribing: 'Transcribing…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
}

export function VoiceTile() {
  const [turns, setTurns] = useState<Array<Turn>>([])
  const [pipeline, setPipeline] = useState<PipelineState>('idle')
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Array<Blob>>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)

  function scrollBottom() {
    requestAnimationFrame(() => {
      if (transcriptRef.current) {
        transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
      }
    })
  }

  function addTurn(role: 'user' | 'assistant', text: string) {
    setTurns((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, role, text },
    ])
    scrollBottom()
  }

  const startRecording = useCallback(async function startRecording() {
    if (pipeline !== 'idle') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      mediaRef.current = recorder
      recorder.start()
      setPipeline('recording')
    } catch {
      setPipeline('idle')
    }
  }, [pipeline])

  const stopRecording = useCallback(async function stopRecording() {
    const recorder = mediaRef.current
    if (!recorder) return

    recorder.stop()
    recorder.stream.getTracks().forEach((t) => t.stop())
    mediaRef.current = null

    setPipeline('transcribing')

    // Wait for final chunk
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
    })

    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    const form = new FormData()
    form.append('audio', blob, 'recording.webm')

    let userText = ''
    try {
      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form })
      if (res.ok) {
        const data = (await res.json()) as { text?: string }
        userText = data.text?.trim() ?? ''
      }
    } catch {
      // fall through
    }

    if (!userText) {
      setPipeline('idle')
      return
    }

    addTurn('user', userText)
    setPipeline('thinking')

    let assistantText = ''
    try {
      const res = await fetch('/api/voice/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText }),
      })
      if (res.ok && res.body) {
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          assistantText += dec.decode(value, { stream: true })
        }
        assistantText = assistantText.trim()
      }
    } catch {
      // fall through
    }

    if (!assistantText) {
      setPipeline('idle')
      return
    }

    addTurn('assistant', assistantText)
    setPipeline('speaking')

    try {
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: assistantText }),
      })
      if (res.ok) {
        const audioBlob = await res.blob()
        const url = URL.createObjectURL(audioBlob)
        const audio = new Audio(url)
        audioRef.current = audio
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve()
          audio.onerror = () => resolve()
          audio.play().catch(() => resolve())
        })
        URL.revokeObjectURL(url)
      }
    } catch {
      // fall through — browser TTS fallback
      if (typeof window !== 'undefined' && assistantText) {
        const utt = new SpeechSynthesisUtterance(assistantText)
        utt.lang = 'en-GB'
        await new Promise<void>((resolve) => {
          utt.onend = () => resolve()
          window.speechSynthesis.speak(utt)
        })
      }
    }

    setPipeline('idle')
  }, [pipeline, addTurn])

  return (
    <div className="flex h-full flex-col bg-primary-50">
      {/* Transcript */}
      <div
        ref={transcriptRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {turns.length === 0 ? (
          <p className="text-center text-xs text-primary-400 mt-8">
            Hold the button to speak
          </p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              className={cn(
                'max-w-[90%] rounded-lg px-3 py-2 text-xs',
                turn.role === 'user'
                  ? 'ml-auto bg-primary-200 text-primary-900'
                  : 'bg-primary-100 text-primary-800',
              )}
            >
              {turn.text}
            </div>
          ))
        )}
      </div>

      {/* PTT */}
      <div className="flex shrink-0 flex-col items-center gap-2 border-t border-primary-300 py-4">
        <button
          type="button"
          onPointerDown={() => void startRecording()}
          onPointerUp={() => void stopRecording()}
          onPointerLeave={() => { if (pipeline === 'recording') void stopRecording() }}
          disabled={pipeline !== 'idle' && pipeline !== 'recording'}
          className={cn(
            'flex h-14 w-14 items-center justify-center rounded-full transition-all focus:outline-none',
            pipeline === 'recording'
              ? 'scale-110 bg-red-500 shadow-lg shadow-red-400/30'
              : 'bg-primary-200 hover:bg-primary-300 active:scale-95',
            (pipeline !== 'idle' && pipeline !== 'recording')
              ? 'cursor-not-allowed opacity-50'
              : '',
          )}
        >
          <HugeiconsIcon
            icon={pipeline === 'recording' ? StopIcon : Mic01Icon}
            size={24}
            strokeWidth={2}
            className={pipeline === 'recording' ? 'text-white' : 'text-primary-700'}
          />
        </button>
        <span className="text-[11px] text-primary-400">
          {STATE_LABEL[pipeline]}
        </span>
      </div>
    </div>
  )
}
