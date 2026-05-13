# Voice Tenant Environment Variables (F3)

Add these to your `.env.local` (copy from `.env.example` first) to enable
multi-tenant STT routing.

```
# ═════════════════════════════════════════════════════════════════
# Multi-tenant Voice Routes (F3 — Mally provisioning)
# ═════════════════════════════════════════════════════════════════
#
# STT (Speech-to-Text) endpoints per tenant.
# henry_cos → local MLX Whisper on Mac Mini (default :8770, fallback :8771).
# mally     → her Mac via Tailscale. Set VOICE_MALLY_STT_URL once her Mac is
#             on Tailscale and Whisper is running.  Leaving this unset causes
#             the transcribe endpoint to return fallbackMode:"text-only" for
#             Mally sessions so the UI shows "Voice not yet provisioned".

VOICE_HENRY_STT_URL=http://127.0.0.1:8770
VOICE_HENRY_STT_URL_FALLBACK=http://127.0.0.1:8771
# VOICE_MALLY_STT_URL=http://mally-mac:8770   # set once Mally's Mac is on Tailscale
```

## Behaviour matrix

| Tenant    | `VOICE_MALLY_STT_URL` set? | STT reachable? | Result                                  |
|-----------|---------------------------|----------------|-----------------------------------------|
| henry_cos | n/a                       | yes (8770)     | Transcribes via `VOICE_HENRY_STT_URL`   |
| henry_cos | n/a                       | no (8770)      | Falls back to `VOICE_HENRY_STT_URL_FALLBACK` |
| mally     | no                        | n/a            | 503 `fallbackMode:"text-only"` — UI shows text tile |
| mally     | yes                       | reachable      | Transcribes via `VOICE_MALLY_STT_URL`   |
| mally     | yes                       | unreachable    | 503 `fallbackMode:"text-only"` — UI shows text tile |
