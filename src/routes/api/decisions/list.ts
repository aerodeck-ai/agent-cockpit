import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  decisionsDirectoryExists,
  listDecisions,
} from '../../../server/decisions-browser'

export const Route = createFileRoute('/api/decisions/list')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const url = new URL(request.url)
          const includeInternal = url.searchParams.get('includeInternal') === '1'
          const exists = decisionsDirectoryExists()
          const decisions = exists ? listDecisions(includeInternal) : []
          return json({ decisions, exists })
        } catch (error) {
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to list decisions',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
