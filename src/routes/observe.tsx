/**
 * /observe — Live agent observability page.
 *
 * Tabs: Flow | Budgets | Evals | Cost | Errors
 *
 * Flow tab ports disler's EventList/EventRow/FilterBar Vue components to React.
 * Source: /Volumes/InfraSSD/oss-study/claude-code-hooks-multi-agent-observability
 */
import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { ObservePage } from '@/screens/observe/ObservePage'

export const Route = createFileRoute('/observe')({
  ssr: false,
  component: ObserveRoute,
})

function ObserveRoute() {
  usePageTitle('Observe')
  return <ObservePage />
}
