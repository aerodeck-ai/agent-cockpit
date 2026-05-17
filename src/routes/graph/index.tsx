/**
 * /graph — Community-summary view of the cross-host Graphify graph.
 *
 * Initial render: community nodes from /graph-summary.json (<300 communities, <2s).
 * Drill-on-click: fetches /api/graph/community/{id} → up to 5k member nodes.
 * Search: POST /api/graph/search → graphify CLI query results.
 *
 * Source graph: ~/graphify-fleet/cross-host-graph.json (~232MB, 349k nodes).
 * Summary prepared by: npm run graph:prepare
 */
import { createFileRoute } from '@tanstack/react-router'
import GraphScreen from '@/screens/graph/graph-screen'

export const Route = createFileRoute('/graph/')({
  ssr: false,
  component: GraphPage,
})

function GraphPage() {
  return <GraphScreen />
}
