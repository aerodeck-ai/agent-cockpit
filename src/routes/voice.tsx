import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { VoiceScreen } from '@/screens/voice/voice-screen'

export const Route = createFileRoute('/voice')({
  ssr: false,
  component: VoiceRoute,
})

function VoiceRoute() {
  usePageTitle('Voice')
  return <VoiceScreen />
}
