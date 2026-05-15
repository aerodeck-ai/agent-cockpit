import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { GoalPage } from '@/screens/goal/GoalPage'

export const Route = createFileRoute('/goal')({
  ssr: false,
  component: GoalRoute,
})

function GoalRoute() {
  usePageTitle('God Mode')
  return <GoalPage />
}
