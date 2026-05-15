/**
 * /api/voice-watchdog-log — Returns last N lines from the voice-watchdog log.
 *
 * The log lives at ~/mcp-infra/logs/voice-watchdog.log (moved from
 * ~/.hammerspoon/voice-watchdog.log in the Karpathy observability bundle).
 *
 * Returns: { lines: string[], path: string, ts: number }
 */
import { createFileRoute } from '@tanstack/react-router'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isAuthenticated } from '../../server/auth-middleware'

const LOG_PATH = join(homedir(), 'mcp-infra', 'logs', 'voice-watchdog.log')
const DEFAULT_LINES = 10

export const Route = createFileRoute('/api/voice-watchdog-log')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const n = Math.min(Number(url.searchParams.get('n') ?? DEFAULT_LINES), 100)

        try {
          const content = await readFile(LOG_PATH, 'utf8')
          const all = content.split('\n').filter(Boolean)
          const lines = all.slice(-n)
          return Response.json({ lines, path: LOG_PATH, ts: Date.now() })
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          return Response.json(
            { lines: [], path: LOG_PATH, ts: Date.now(), error: msg },
            { status: 200 }, // 200 so tile renders gracefully even if log missing
          )
        }
      },
    },
  },
})
