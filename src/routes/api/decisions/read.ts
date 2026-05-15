import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { readDecisionBody } from '../../../server/decisions-browser'

export const Route = createFileRoute('/api/decisions/read')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const filename = (url.searchParams.get('filename') ?? '').trim()

        if (!filename) {
          return json({ error: 'filename query param is required' }, { status: 400 })
        }

        try {
          const { meta, content } = readDecisionBody(filename)
          return json({ meta, content })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to read decision'
          const status =
            /traversal|separators|outside|not allowed|required/i.test(message)
              ? 400
              : /ENOENT/.test(message)
                ? 404
                : 500
          return json({ error: message }, { status })
        }
      },
    },
  },
})
