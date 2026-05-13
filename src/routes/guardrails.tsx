import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { GuardrailsScreen } from '@/screens/guardrails/guardrails-screen'

export const Route = createFileRoute('/guardrails')({
  ssr: false,
  component: GuardrailsRoute,
})

function GuardrailsRoute() {
  usePageTitle('Guardrails')
  return (
    <div className="min-h-full overflow-y-auto bg-surface text-ink">
      <GuardrailsScreen />
    </div>
  )
}
