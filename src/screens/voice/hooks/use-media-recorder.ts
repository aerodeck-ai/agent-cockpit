/**
 * useMediaRecorder — push-to-talk browser MediaRecorder hook.
 *
 * Captures audio from the user's microphone using the MediaRecorder API.
 * Emits an audio Blob on release (pointerup / stop()).
 *
 * The blob is webm/opus on Chrome/Firefox, and Safari falls back to
 * audio/mp4.  Both formats are accepted by the MLX STT server at :8770.
 */

import { useRef, useState, useCallback } from 'react'

export type RecorderState = 'idle' | 'recording' | 'error'

interface UseMediaRecorderOptions {
  /** Called with the recorded audio Blob when recording stops */
  onBlob: (blob: Blob) => void
}

export function useMediaRecorder({ onBlob }: UseMediaRecorderOptions) {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(async () => {
    if (state === 'recording') return
    setError(null)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16_000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone access denied'
      setError(msg)
      setState('error')
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    // Prefer webm/opus for smallest payload; fall back to whatever is supported
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : ''

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const blobType = mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: blobType })
      chunksRef.current = []
      // Stop all tracks to release the mic indicator
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setState('idle')
      onBlob(blob)
    }

    recorder.onerror = () => {
      setError('Recording error')
      setState('error')
    }

    recorder.start(100) // collect in 100ms chunks
    setState('recording')
  }, [state, onBlob])

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  /** Cancel without emitting a blob — clears state silently */
  const cancel = useCallback(() => {
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') {
      // Override ondataavailable to discard data
      rec.ondataavailable = null
      rec.onstop = null
      rec.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    chunksRef.current = []
    mediaRecorderRef.current = null
    setState('idle')
  }, [])

  return { state, error, start, stop, cancel }
}
