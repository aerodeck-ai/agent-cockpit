/**
 * useAudioPlayer — ArrayBuffer → AudioContext playback hook.
 *
 * Accepts raw audio bytes from the TTS server (:8908) and plays them via
 * the Web Audio API.  Auto-stops any currently playing audio when a new
 * buffer is passed.  Exposes { playing, play, stop }.
 */

import { useRef, useState, useCallback } from 'react'

export function useAudioPlayer() {
  const [playing, setPlaying] = useState(false)
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)

  const getContext = useCallback((): AudioContext => {
    if (!contextRef.current || contextRef.current.state === 'closed') {
      contextRef.current = new AudioContext()
    }
    if (contextRef.current.state === 'suspended') {
      void contextRef.current.resume()
    }
    return contextRef.current
  }, [])

  const stop = useCallback(() => {
    try {
      sourceRef.current?.stop()
    } catch {
      // already stopped — ignore
    }
    sourceRef.current = null
    setPlaying(false)
  }, [])

  const play = useCallback(
    async (buffer: ArrayBuffer) => {
      // Stop any in-progress playback first
      stop()

      const ctx = getContext()
      let audioBuffer: AudioBuffer

      try {
        audioBuffer = await ctx.decodeAudioData(buffer)
      } catch (err) {
        console.error('[useAudioPlayer] decodeAudioData failed', err)
        setPlaying(false)
        return
      }

      const source = ctx.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ctx.destination)
      sourceRef.current = source

      source.onended = () => {
        sourceRef.current = null
        setPlaying(false)
      }

      setPlaying(true)
      source.start(0)
    },
    [stop, getContext],
  )

  return { playing, play, stop }
}
