import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { DecisionsScreen } from '@/screens/decisions/DecisionsScreen'

export const Route = createFileRoute('/decisions')({
  ssr: false,
  component: DecisionsRoute,
})

function DecisionsRoute() {
  usePageTitle('Decisions')
  return <DecisionsScreen />
}
