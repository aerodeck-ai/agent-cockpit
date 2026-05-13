/**
 * POST /api/voice/speak
 *
 * Forwards a TTS request to the local chatterbox server at :8908.
 * Returns raw audio bytes (MP3 from ElevenLabs, WAV from Piper fallback).
 *
 * If :8908 is unreachable, returns 503 so the client can fall back to
 * browser SpeechSynthesis.
 *
 * Request body: { text: string, voice_ref?: "henry" | "mally" }
 * Response: audio/mpeg or audio/wav bytes
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'

// Mac chatterbox (ElevenLabs primary + Piper fallback) via Tailscale.
// Override with VOICE_TTS_BASE env for local dev.
const TTS_BASE = process.env.VOICE_TTS_BASE ?? 'http://100.89.244.20:8908'

async function isTtsAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_BASE}/health`, { signal: AbortSignal.timeout(1_500) })
    return res.ok
  } catch {
    return false
  }
}

export const Route = createFileRoute('/api/voice/speak')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json' },
          })
        }

        let body: { text?: string; voice_ref?: string }
        try {
          body = await request.json() as { text?: string; voice_ref?: string }
        } catch {
          return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }

        const text = typeof body.text === 'string' ? body.text.trim() : ''
        if (!text) {
          return new Response(JSON.stringify({ ok: false, error: 'Missing text' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }

        const voiceRef = typeof body.voice_ref === 'string' ? body.voice_ref : 'henry'

        const alive = await isTtsAlive()
        if (!alive) {
          return new Response(JSON.stringify({ ok: false, error: 'TTS service unavailable' }), {
            status: 503, headers: { 'Content-Type': 'application/json' },
          })
        }

        let ttsResp: Response
        try {
          ttsResp = await fetch(`${TTS_BASE}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, voice_ref: voiceRef }),
            signal: AbortSignal.timeout(15_000),
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'TTS request failed'
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          })
        }

        if (!ttsResp.ok) {
          const errBody = await ttsResp.text().catch(() => '')
          return new Response(JSON.stringify({ ok: false, error: `TTS error ${ttsResp.status}: ${errBody}` }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          })
        }

        const audioBuffer = await ttsResp.arrayBuffer()
        const audioContentType = ttsResp.headers.get('content-type') || 'audio/mpeg'

        return new Response(audioBuffer, {
          status: 200,
          headers: {
            'Content-Type': audioContentType,
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
