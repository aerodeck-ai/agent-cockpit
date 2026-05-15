import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { BuildPage } from '@/screens/build/BuildPage'

export const Route = createFileRoute('/build')({
  ssr: false,
  component: BuildRoute,
})

function BuildRoute() {
  usePageTitle('Build')
  return <BuildPage />
}
