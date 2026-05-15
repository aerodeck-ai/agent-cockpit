import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { WatchdogsScreen } from '@/screens/watchdogs/WatchdogsScreen'

export const Route = createFileRoute('/watchdogs')({
  ssr: false,
  component: WatchdogsRoute,
})

function WatchdogsRoute() {
  usePageTitle('Watchdogs')
  return <WatchdogsScreen />
}
