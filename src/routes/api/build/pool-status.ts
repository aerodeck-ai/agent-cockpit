import { createFileRoute } from '@tanstack/react-router'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { requireLocalOrAuth } from '../../../server/auth-middleware'

const execFileP = promisify(execFile)

// GET /api/build/pool-status — count live build-pane-* tmux sessions so the
// build grid can surface "N sessions live". Read-only; no spawn/kill here.
export const Route = createFileRoute('/api/build/pool-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!requireLocalOrAuth(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }
        try {
          const { stdout } = await execFileP(
            'tmux',
            ['list-sessions', '-F', '#{session_name}'],
            { timeout: 4000 },
          )
          const sessions = stdout
            .split('\n')
            .filter((s) => s.startsWith('build-pane-')).length
          return new Response(JSON.stringify({ ok: true, sessions }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        } catch {
          // tmux exits non-zero when no server is running — that's 0 sessions.
          return new Response(JSON.stringify({ ok: true, sessions: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      },
    },
  },
})
