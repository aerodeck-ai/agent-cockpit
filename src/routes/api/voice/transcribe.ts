/**
 * POST /api/voice/transcribe
 *
 * Forwards raw audio bytes to the per-tenant MLX Whisper STT server.
 * Tenant is resolved from CF Access identity header (cf-access-authenticated-user-email).
 *
 * Henry  → VOICE_STT_PRIMARY  (default: Henry's Mac 100.89.244.20:8770)
 *          VOICE_STT_FALLBACK (default: Henry's Mac 100.89.244.20:8771 CPU)
 * Mally  → VOICE_MALLY_STT_URL (default: Mally's Mac 100.114.38.97:8770)
 *          falls back to Henry's VOICE_STT_FALLBACK if Mally's unreachable
 *
 * Request body: raw audio bytes (any content-type; multipart/form-data
 *   with field "audio" OR raw bytes in body).
 * Response: { ok: true, text: string, backend: string, duration_ms: number, tenant: string }
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { resolveTenantFromRequest } from '../../../lib/auth/tenants'

// Henry's Mac MLX Whisper via Tailscale (canonical big-model host)
const HENRY_STT_PRIMARY  = process.env.VOICE_STT_PRIMARY  ?? 'http://100.89.244.20:8770'
const HENRY_STT_FALLBACK = process.env.VOICE_STT_FALLBACK ?? 'http://100.89.244.20:8771'

// Mally's Mac MLX Whisper via Tailscale (peer voice-compute appliance, Phase 7B)
const MALLY_STT_PRIMARY  = process.env.VOICE_MALLY_STT_URL ?? 'http://100.114.38.97:8770'

async function pickSttBaseForTenant(tenant: string | null): Promise<{ base: string; resolvedTenant: string }> {
  // Mally gets her own Mac first, falls back to Henry's CPU STT
  if (tenant === 'mally') {
    try {
      const res = await fetch(`${MALLY_STT_PRIMARY}/health`, { signal: AbortSignal.timeout(1_500) })
      if (res.ok) return { base: MALLY_STT_PRIMARY, resolvedTenant: 'mally' }
    } catch {
      // fall through to Henry fallback
    }
    return { base: HENRY_STT_FALLBACK, resolvedTenant: 'mally-fallback' }
  }

  // Henry (or unauthenticated default): try primary then fallback
  try {
    const res = await fetch(`${HENRY_STT_PRIMARY}/health`, { signal: AbortSignal.timeout(1_500) })
    if (res.ok) return { base: HENRY_STT_PRIMARY, resolvedTenant: tenant ?? 'henry_cos' }
  } catch {
    // fall through
  }
  return { base: HENRY_STT_FALLBACK, resolvedTenant: `${tenant ?? 'henry_cos'}-fallback` }
}

export const Route = createFileRoute('/api/voice/transcribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Resolve tenant from CF Access identity (or null for local dev)
        const tenantInfo = resolveTenantFromRequest(request)
        const { base, resolvedTenant } = await pickSttBaseForTenant(tenantInfo?.tenant ?? null)

        let audioData: ArrayBuffer
        const contentType = request.headers.get('content-type') || ''

        if (contentType.includes('multipart/form-data')) {
          // Accept FormData with field "audio"
          let formData: FormData
          try {
            formData = await request.formData()
          } catch {
            return new Response(JSON.stringify({ ok: false, error: 'Invalid form data' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            })
          }
          const file = formData.get('audio')
          if (!(file instanceof File)) {
            return new Response(JSON.stringify({ ok: false, error: 'Missing audio field' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            })
          }
          audioData = await file.arrayBuffer()
        } else {
          // Raw bytes
          audioData = await request.arrayBuffer()
        }

        if (audioData.byteLength === 0) {
          return new Response(JSON.stringify({ ok: false, error: 'Empty audio' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }

        let sttResp: Response
        try {
          sttResp = await fetch(`${base}/transcribe`, {
            method: 'POST',
            headers: {
              'Content-Type': contentType.includes('multipart') ? 'audio/webm' : (contentType || 'audio/webm'),
            },
            body: audioData,
            signal: AbortSignal.timeout(30_000),
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'STT request failed'
          return new Response(JSON.stringify({ ok: false, error: msg, tenant: resolvedTenant }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          })
        }

        if (!sttResp.ok) {
          const body = await sttResp.text().catch(() => '')
          return new Response(JSON.stringify({ ok: false, error: `STT error ${sttResp.status}: ${body}`, tenant: resolvedTenant }), {
            status: 502, headers: { 'Content-Type': 'application/json' },
          })
        }

        const result = await sttResp.json() as { text: string; backend?: string; duration_ms?: number }
        return new Response(JSON.stringify({ ok: true, text: result.text, backend: result.backend, duration_ms: result.duration_ms, tenant: resolvedTenant }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
