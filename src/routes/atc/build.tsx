import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { AtcBuildScreen } from '@/screens/atc-build/atc-build-screen'

// /atc/build — 6-pane Claude/Codex/DeepSeek/Shell build grid.
// Auth: CF Access at the atc.berl.ai edge + /api/terminal-stream's own
// requireLocalOrAuth gate. ssr:false because xterm.js touches `self`.
export const Route = createFileRoute('/atc/build')({
  ssr: false,
  component: function AtcBuildRoute() {
    usePageTitle('Build Grid')
    return <AtcBuildScreen />
  },
})
