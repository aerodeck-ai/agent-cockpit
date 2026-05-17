import { createFileRoute } from '@tanstack/react-router'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { requireLocalOrAuth } from '../../../server/auth-middleware'

const execFileP = promisify(execFile)

// POST /api/build/dispatch
// Body: { paneIndex: number, prompt: string }
// Flow (Polish #5): prompt → HCoS api_server (/v1/chat/completions) → HCoS
// returns a directive → `tmux send-keys -t build-pane-<N>-claude` injects it
// into the target pane. Returns the HCoS reply + dispatched status.
//
// HCoS api_server: http://127.0.0.1:8642 (same Oracle host as agent-cockpit
// prod). API key read at runtime from ~/.hermes/.env (NOT committed; secret
// stays on disk per the no-credentials-in-git rule).

const HCOS_BASE = process.env.HCOS_API_BASE ?? 'http://127.0.0.1:8642'
const HERMES_ENV = process.env.HERMES_ENV_PATH ?? '/home/ubuntu/.hermes/.env'

function hcosApiKey(): string {
  if (process.env.HERMES_API_SERVER_KEY) return process.env.HERMES_API_SERVER_KEY
  try {
    const env = readFileSync(HERMES_ENV, 'utf8')
    const m = env.match(/^API_SERVER_KEY=(.+)$/m)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

function sanitizePaneIndex(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null
}

export const Route = createFileRoute('/api/build/dispatch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        let body: { paneIndex?: unknown; prompt?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return new Response(
            JSON.stringify({ ok: false, error: 'Invalid JSON' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const paneIndex = sanitizePaneIndex(body.paneIndex)
        const prompt =
          typeof body.prompt === 'string' ? body.prompt.trim() : ''
        if (paneIndex === null || !prompt) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: 'paneIndex (1-6) and non-empty prompt required',
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }

        const key = hcosApiKey()
        let hcosReply = ''
        let hcosOk = false
        if (key) {
          try {
            const res = await fetch(`${HCOS_BASE}/v1/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
              },
              body: JSON.stringify({
                model: 'hermes-agent',
                messages: [
                  {
                    role: 'system',
                    content:
                      'You are HCoS dispatching to a Claude Code build pane. ' +
                      'Reply with the exact one-line shell/Claude command to run. ' +
                      'No prose, no backticks — just the command.',
                  },
                  { role: 'user', content: prompt },
                ],
                max_tokens: 400,
              }),
              signal: AbortSignal.timeout(20_000),
            })
            if (res.ok) {
              const data = (await res.json()) as {
                choices?: Array<{ message?: { content?: string } }>
              }
              hcosReply = data.choices?.[0]?.message?.content?.trim() ?? ''
              hcosOk = hcosReply.length > 0
            } else {
              hcosReply = `HCoS HTTP ${res.status}`
            }
          } catch (e) {
            hcosReply = `HCoS unreachable: ${(e as Error).message}`
          }
        } else {
          hcosReply = 'HCoS API key not found on host'
        }

        // The directive injected into the pane: HCoS's command if it produced
        // one, else the raw prompt (so the dispatcher still works if HCoS is
        // down — the pane is a real Claude session that can take the prompt).
        const directive = hcosOk ? hcosReply : prompt
        const session = `build-pane-${paneIndex}-claude`

        let dispatched = false
        let dispatchErr = ''
        try {
          // send-keys the directive then Enter. -l sends literally (no key
          // interpretation) for the text; Enter sent separately.
          await execFileP('tmux', ['send-keys', '-t', session, '-l', directive], {
            timeout: 4000,
          })
          await execFileP('tmux', ['send-keys', '-t', session, 'Enter'], {
            timeout: 4000,
          })
          dispatched = true
        } catch (e) {
          dispatchErr = (e as Error).message
        }

        return new Response(
          JSON.stringify({
            ok: dispatched,
            paneIndex,
            session,
            hcos_ok: hcosOk,
            hcos_reply: hcosReply,
            directive,
            dispatched,
            error: dispatched ? undefined : dispatchErr || 'tmux send-keys failed',
          }),
          {
            status: dispatched ? 200 : 502,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      },
    },
  },
})
