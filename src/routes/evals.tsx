/**
 * /evals — Eval runs viewer
 *
 * Two tabs:
 *   - Runs: table of the latest 30 eval runs from eval_runs.db
 *   - Compare: side-by-side diff of two runs
 */
import { createFileRoute } from '@tanstack/react-router'
import { usePageTitle } from '@/hooks/use-page-title'
import { EvalsScreen } from '@/screens/evals/evals-screen'

export const Route = createFileRoute('/evals')({
  ssr: false,
  component: EvalsRoute,
})

function EvalsRoute() {
  usePageTitle('Evals')
  return <EvalsScreen />
}
